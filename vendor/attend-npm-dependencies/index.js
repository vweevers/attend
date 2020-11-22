'use strict'

const vfile = require('vfile')
const jsonMap = require('json-source-map')
const semverSatisfies = require('semver/functions/satisfies')
const semverMinVersion = require('semver/ranges/min-version')
const semverGt = require('semver/functions/gt')
const promisify = require('util').promisify
const memoize = require('thunky-with-args')
const packument = memoize(require('packument').factory({ keepAlive: true }))
const getPackage = promisify(require('packument-package').factory(packument))
const npmCheck = require('npm-check')
const EventEmitter = require('events')
const spawn = require('child_process').spawn
const path = require('path')
const fs = require('fs')
const fsp = fs.promises
const hasOwnProperty = Object.prototype.hasOwnProperty

module.exports = function (pluginOptions) {
  pluginOptions = pluginOptions || {}

  const plugin = new EventEmitter()
  const only = pluginOptions.only
  const ignore = pluginOptions.ignore
  const bump = !!pluginOptions.bump

  plugin.init = async function (options) {
    const cwd = path.resolve(options.cwd || '.')

    if (!fs.existsSync(path.join(cwd, 'node_modules'))) {
      await npm(cwd, ['i'], null, plugin)
    }
  }

  plugin.lint = async function (options) {
    const cwd = path.resolve(options.cwd || '.')
    const bare = !fs.existsSync(path.join(cwd, 'node_modules'))
    const packages = await check({ cwd, bump, bare, only, ignore })

    return { files: [finalize(cwd, packages)] }
  }

  plugin.fix = async function (options) {
    const cwd = path.resolve(options.cwd || '.')
    const bare = !fs.existsSync(path.join(cwd, 'node_modules'))
    const remove = { prod: [], dev: [] }
    const install = { prod: { '^': [], '~': [], '': [] }, dev: { '^': [], '~': [], '': [] } }
    const packages = await check({ cwd, bump, bare, only, ignore })

    // In bare mode, update package.json directly without npm
    const newPkg = bare ? readPackage(cwd) : null

    for (const item of packages) {
      const id = item.moduleName

      if (item.fix && item.fix.action === 'remove') {
        item.messages = item.messages.filter(unfixable)

        if (newPkg) {
          if (newPkg.dependencies) newPkg.dependencies[id] = undefined
          if (newPkg.devDependencies) newPkg.devDependencies[id] = undefined
          if (newPkg.optionalDependencies) newPkg.optionalDependencies[id] = undefined
        } else {
          remove[item.devDependency ? 'dev' : 'prod'].push(id)
        }
      } else if (item.fix && item.fix.action === 'install' && item.fix.version) {
        item.messages = item.messages.filter(unfixable)

        if (newPkg) {
          const group = newPkg[item.devDependency ? 'devDependencies' : 'dependencies']
          const spec = (item.fix.savePrefix || '^') + item.fix.version

          group[id] = spec
        } else {
          const group = install[item.devDependency ? 'dev' : 'prod']
          const spec = id + '@' + item.fix.version

          group[item.fix.savePrefix || ''].push(spec)
        }
      }
    }

    if (newPkg) {
      const json = JSON.stringify(newPkg, null, 2) + '\n'
      await fsp.writeFile(path.join(cwd, 'package.json'), json)
    }

    for (const group of ['prod', 'dev']) {
      const save = group === 'prod' ? '--save' : '--save-dev'

      if (remove[group].length) {
        await npm(cwd, ['rm', ...remove[group], save], null, plugin)
      }

      for (const savePrefix of ['^', '~', '']) {
        if (install[group][savePrefix].length) {
          const env = savePrefix ? { npm_config_save_prefix: savePrefix } : null
          await npm(cwd, ['i', ...install[group][savePrefix], save], env, plugin)
        }
      }
    }

    // Get message positions *after* updating package.json
    return { files: [finalize(cwd, packages)] }
  }

  return plugin
}

function tryRead (fp) {
  try {
    return fs.readFileSync(fp, 'utf8')
  } catch {
    return null
  }
}

// TODO (refactor): move out, to be used by other attend
// plugins (having cached the results in memory)
async function check ({ cwd, bump, bare, only, ignore }) {
  cwd = path.resolve(cwd || '.')

  // Don't check for unused deps, too many false positives
  const currentState = await npmCheck({ cwd, skipUnused: true })
  const include = packagefilter(only, ignore)
  const packages = currentState.get('packages').filter(include)
  const pkg = readPackage(cwd)

  return Promise.all(packages.map(async function (item) {
    const id = item.moduleName
    const messages = item.messages = []

    item.outdated = false
    item.ignoreUpdates = false
    item.fix = null

    if (item.regError) {
      messages.push({
        fatal: true,
        fixable: false,
        reason: error(item.regError),
        ruleId: 'no-registry-error'
      })
      return item
    }

    if (item.unused) {
      item.ignoreUpdates = true
      item.fix = { action: 'remove' }
      messages.push({
        fatal: false,
        fixable: true,
        reason: `Remove unused dependency \`${id}\``,
        ruleId: 'no-unused'
      })
      return item
    }

    if (bump && semverGt(item.latest, item.packageWanted)) {
      const explicitlyIncluded = include.only(item)

      if (!explicitlyIncluded && /^\d/.test(item.packageJson)) {
        // Probably pinned for a reason. Only warn
        item.outdated = true
        item.ignoreUpdates = true
        messages.push({
          fatal: false,
          fixable: false,
          reason: `Skip bumping pinned \`${id}\` from \`${item.packageWanted}\` to \`${item.latest}\``,
          ruleId: 'bump'
        })
      } else if (!explicitlyIncluded && !(await compatible(pkg, item))) {
        item.outdated = true
        item.ignoreUpdates = true
        messages.push({
          fatal: false,
          fixable: false,
          reason: `Skip bumping incompatible \`${id}\` to \`${item.latest}\``,
          ruleId: 'bump'
        })
      } else {
        item.outdated = true
        item.fix = updateFix(item)
        messages.push({
          fatal: true,
          fixable: true,
          reason: `Bump \`${id}\` from \`${item.packageWanted}\` to \`${item.latest}\``,
          ruleId: 'bump'
        })
      }
    }

    if (!bare) {
      if (item.notInstalled) {
        // An existing fix from above (with a new version) takes precedence
        item.fix = item.fix || installFix(item)
        messages.push({
          fatal: true,
          fixable: true,
          reason: `Install missing dependency \`${id}\``,
          ruleId: 'no-missing'
        })
      } else if (item.pkgError) {
        item.fix = item.fix || installFix(item)
        messages.push({
          fatal: true,
          fixable: true,
          reason: error(item.pkgError),
          ruleId: 'valid-package'
        })
      } else if (item.mismatch) {
        item.fix = item.fix || installFix(item)
        messages.push({
          fatal: true,
          fixable: true,
          reason: `Wants \`${id} ${item.packageWanted}\`, has \`${item.installed}\``,
          ruleId:  'no-mismatch'
        })
      } else if (!item.semverValid) {
        item.fix = item.fix || installFix(item)
        messages.push({
          fatal: true,
          fixable: true,
          reason: `Fix invalid version: \`${id} ${item.installed}\``,
          ruleId: 'valid-version'
        })
      }
    }

    return item
  }))
}

function updateFix (item) {
  return getFix(item, item.latest)
}

function installFix (item) {
  return getFix(item, item.packageWanted)
}

function getFix (item, version) {
  // Honor existing prefix
  const char = item.packageJson[0]
  const savePrefix = char === '^' || char === '~' ? char : null

  return { action: 'install', version, savePrefix }
}

function finalize (cwd, packages) {
  const contents = tryRead(path.join(cwd, 'package.json'))
  const packageFile = vfile({ path: 'package.json', cwd, contents })
  const position = contents ? positions(contents) : () => null

  for (const item of packages) {
    if (item.messages.length === 0) {
      continue
    }

    const pos = position(item.moduleName, item.devDependency)

    for (const { reason, ruleId, fatal } of item.messages) {
      const origin = ruleId ? `attend-npm-dependencies:${ruleId}` : null
      const msg = packageFile.message(reason, pos, origin)

      if (fatal) msg.fatal = true
    }
  }

  return packageFile
}

// TODO: vfile-message has a .stack property,
// use that here and in vfile-reporter-shiny
function error (err) {
  return String(err.stack || err)
}

function packagefilter (only, ignore) {
  only = [].concat(only || [])
  ignore = [].concat(ignore || [])

  // Check if a dependency should be included
  const include = function (item) {
    if (only.length && !only.includes(item.moduleName)) return false
    if (ignore.includes(item.moduleName)) return false

    return true
  }

  // Check if a dependency is explicitly included
  include.only = function (item) {
    return only.includes(item.moduleName)
  }

  return include
}

function unfixable (message) {
  return !message.fixable
}

// TODO: use pacote or npm-registry-fetch to make use of npm's cache
async function compatible (ourPkg, item) {
  const ourEngine = ourPkg.engines && ourPkg.engines.node

  if (!ourEngine) return true

  const theirPkg = await getPackage(item.moduleName, item.latest)
  const theirEngine = theirPkg.engines && theirPkg.engines.node

  if (!theirEngine) return true

  return semverSatisfies(semverMinVersion(ourEngine), theirEngine)
}

function npm (cwd, args, env, ee) {
  env = {
    ...process.env,
    ...env,
    npm_config_audit: 'false',
    npm_config_progress: 'false',
    npm_config_update_notifier: 'false',
    npm_config_loglevel: 'http'
  }

  return new Promise(function (resolve, reject) {
    const stdio = ['ignore', 'pipe', 'pipe']
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    const subprocess = spawn(npm, args, { cwd, stdio, env })

    if (!ee.emit('subprocess', subprocess)) {
      subprocess.stdout.pipe(process.stderr, { end: false })
      subprocess.stderr.pipe(process.stderr, { end: false })
    }

    subprocess.on('error', reject)
    subprocess.on('close', function (code) {
      if (code !== 0) return reject(new Error(`npm exited with code ${code}`))
      resolve()
    })
  })
}

function positions (contents) {
  const pointers = jsonMap.parse(contents).pointers

  return function position (id, dev) {
    const pointer = dev
      ? pointers[`/devDependencies/${id}`]
      : pointers[`/dependencies/${id}`]

    if (pointer) {
      return {
        start: fixPosition(pointer.key),
        end: fixPosition(pointer.valueEnd)
      }
    }
  }
}

function fixPosition (pos) {
  for (const k in pos) {
    // Is zero-indexed
    if (hasOwnProperty.call(pos, k)) pos[k] = pos[k] + 1
  }

  return pos
}

function readPackage (cwd) {
  const fp = path.join(cwd, 'package.json')
  const json = fs.readFileSync(fp, 'utf8')

  return JSON.parse(json)
}
