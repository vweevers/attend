'use strict'

const vfile = require('vfile')
const jsonMap = require('json-source-map')
const npmCheck = require('npm-check')
const EventEmitter = require('events')
const spawn = require('child_process').spawn
const path = require('path')
const fs = require('fs')
const hasOwnProperty = Object.prototype.hasOwnProperty

module.exports = function (pluginOptions) {
  pluginOptions = pluginOptions || {}

  const plugin = new EventEmitter()
  const include = packagefilter(pluginOptions)
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
    const lazyMessages = new LazyMessages(cwd, include, bump, bare)
    const currentState = await npmCheck({ cwd, skipUnused: true })
    const packages = currentState.get('packages')

    for (const item of packages) {
      lazyMessages.lintItem(item)
    }

    return { files: [lazyMessages.finalize()] }
  }

  plugin.fix = async function (options) {
    const cwd = path.resolve(options.cwd || '.')
    const bare = !fs.existsSync(path.join(cwd, 'node_modules'))
    const lazyMessages = new LazyMessages(cwd, include, bump, bare)

    // TODO: in bare mode, update package.json directly without npm
    if (bare) {
      await npm(cwd, ['i'], null, plugin)
    }

    const currentState = await npmCheck({ cwd, skipUnused: true })
    const packages = currentState.get('packages')

    const remove = {
      prod: [],
      dev: []
    }

    const update = {
      prod: { caret: [], tilde: [], default: [] },
      dev: { caret: [], tilde: [], default: [] }
    }

    for (const item of packages) {
      if (!include(item) || item.regError) {
        lazyMessages.lintItem(item)
      } else if (item.unused) {
        remove[item.devDependency ? 'dev' : 'prod'].push(item.moduleName)
      } else if (fixable(item, bump, bare)) {
        const prefix = item.packageJson[0]
        const group = item.devDependency ? 'dev' : 'prod'
        const type = prefix === '^' ? 'caret' : prefix === '~' ? 'tilde' : 'default'

        update[group][type].push(item.moduleName + '@' + item.latest)
      }
    }

    for (const group of ['prod', 'dev']) {
      const save = group === 'prod' ? '--save' : '--save-dev'

      if (remove[group].length) {
        await npm(cwd, ['rm', ...remove[group], save], null, plugin)
      }

      if (update[group].caret.length) {
        await npm(cwd, ['i', ...update[group].caret, save], { npm_config_save_prefix: '^' }, plugin)
      }

      if (update[group].tilde.length) {
        await npm(cwd, ['i', ...update[group].tilde, save], { npm_config_save_prefix: '~' }, plugin)
      }

      if (update[group].default.length) {
        await npm(cwd, ['i', ...update[group].default, save], null, plugin)
      }
    }

    // Get message positions *after* updating package.json
    return { files: [lazyMessages.finalize()] }
  }

  return plugin
}

function fixable (item, bump, bare) {
  return (
    (!bare && item.mismatch) ||
    (!bare && item.pkgError) ||
    (!bare && !item.semverValid) ||
    (!bare && item.notInstalled) ||
    (bump && item.packageWanted !== item.latest)
  )
}

function tryRead (fp) {
  try {
    return fs.readFileSync(fp, 'utf8')
  } catch {
    return null
  }
}

class LazyMessages {
  constructor (cwd, include, bump, bare) {
    this.cwd = cwd
    this.include = include
    this.bump = bump
    this.bare = bare
    this.queue = []
  }

  info (item, msg, rule) {
    this.queue.push({ item, msg, rule, level: 'info' })
  }

  warn (item, msg, rule) {
    this.queue.push({ item, msg, rule, level: 'warn' })
  }

  fatal (item, msg, rule) {
    this.queue.push({ item, msg, rule, level: 'fatal' })
  }

  lintItem (item) {
    const { moduleName: id, devDependency: dev } = item

    if (item.regError) {
      this.fatal(item, error(item.regError), 'no-registry-error')
    } else if (item.unused) {
      this.warn(item, `Remove unused dependency \`${id}\``, 'no-unused')
    } else if (item.notInstalled && !this.bare) {
      this.fatal(item, `Install missing dependency \`${id}\``, 'no-missing')
    } else if (item.pkgError && !this.bare) {
      this.fatal(item, error(item.pkgError), 'valid-package')
    } else if (item.mismatch && !this.bare) {
      this.fatal(item, `Wants \`${id} ${item.packageWanted}\`, has \`${item.installed}\``, 'no-mismatch')
    } else if (!item.semverValid && !this.bare) {
      this.fatal(item, `Fix invalid version: \`${id} ${item.installed}\``, 'valid-version')
    } else if (this.bump && item.packageWanted !== item.latest) {
      if (/^\d/.test(item.packageJson) && !this.include.only(item)) {
        // Probably pinned for a reason. Only warn
        const msg = `Bump pinned \`${id}\` from \`${item.packageWanted}\` to \`${item.latest}\``
        this.warn(item, msg, 'bump')
      } else {
        const msg = `Bump \`${id}\` from \`${item.packageWanted}\` to \`${item.latest}\``
        this.fatal(item, msg, 'bump')
      }
    }
  }

  finalize () {
    const cwd = this.cwd
    const contents = tryRead(path.join(cwd, 'package.json'))
    const packageFile = vfile({ path: 'package.json', cwd, contents })
    const position = contents ? positions(contents) : () => null

    for (const { item, msg, rule, level } of this.queue) {
      const pos = item ? position(item.moduleName, item.devDependency) : null
      const origin = rule ? `attend-npm-dependencies:${rule}` : null

      if (level !== 'info' && (!item || this.include(item))) {
        const message = packageFile.message(msg, pos, origin)

        if (level === 'fatal') message.fatal = true
      } else {
        // packageFile.info(`(${msg})`, pos, origin)
      }
    }

    return packageFile
  }
}

function error (err) {
  return String(err.stack || err)
}

function packagefilter (pluginOptions) {
  const only = [].concat(pluginOptions.only || [])
  const ignore = [].concat(pluginOptions.ignore || [])

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
