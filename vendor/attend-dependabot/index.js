'use strict'

const vfile = require('vfile')
const YAML = require('js-yaml')
const deepEqual = require('deep-equal')
const path = require('path')
const fs = require('fs')
const fsp = fs.promises

module.exports = function (options) {
  return {
    async init (project) {
      const cwd = path.resolve(project.cwd || '.')
      const fp = path.join(cwd, '.github/dependabot.yml')

      return fs.existsSync(fp) ? null : run(project, options, true)
    },

    async lint (project) {
      return run(project, options, false)
    },

    async fix (project) {
      return run(project, options, true)
    }
  }
}

async function run (project, options, fix) {
  const cwd = path.resolve(project.cwd || '.')
  const fp = path.join(cwd, '.github/dependabot.yml')
  const file = vfile({ path: '.github/dependabot.yml', cwd })
  const files = [file]
  const exists = fs.existsSync(fp)

  // TODO: use an AST parser so we can get positions
  const yaml = exists ? await fsp.readFile(fp, 'utf8') : '{ version: 2, updates: [] }'
  const prevConfig = YAML.safeLoad(yaml)
  const config = YAML.safeLoad(yaml) || {}

  if (fix) {
    config.version = 2
  } else if (config.version !== 2) {
    file.message('Version must be 2', null, 'attend-dependabot:version').fatal = true
    return { files }
  }

  if (fix && !config.updates) {
    config.updates = []
  } else if (!Array.isArray(config.updates)) {
    file.message('Expecting `updates` to be an array', null, 'attend-dependabot:updates').fatal = true
    return { files }
  }

  if (!fix && config.updates.some(e => !e)) {
    file.message('Expecting `updates` entries to be non-null', null, 'attend-dependabot:updates').fatal = true
  }

  config.updates = config.updates.filter(Boolean)

  const desiredEcosystems = await guessDesiredEcosystems(cwd, project)
  const currentEcosystems = new Set()

  for (const entry of config.updates) {
    const ecosystem = entry['package-ecosystem']

    if (!ecosystem) {
      file.message('Package ecosystem is required', null, 'attend-dependabot:ecosystem').fatal = true
    } else if (typeof ecosystem !== 'string') {
      file.message('Package ecosystem must be a string', null, 'attend-dependabot:ecosystem').fatal = true
    } else if (currentEcosystems.has(ecosystem)) {
      file.message('Found duplicate package ecosystem', null, 'attend-dependabot:ecosystem').fatal = true
    } else {
      currentEcosystems.add(ecosystem)
    }

    if (!entry.directory) {
      if (fix) {
        entry.directory = '/'
      } else {
        file.message('Directory is required', null, 'attend-dependabot:directory').fatal = true
      }
    } else if (typeof entry.directory !== 'string') {
      file.message('Directory must be a string', null, 'attend-dependabot:directory').fatal = true
    }

    if (entry.schedule != null && typeof entry.schedule !== 'object') {
      file.message('Schedule must be an object', null, 'attend-dependabot:schedule').fatal = true
    }

    if (options.interval && (!entry.schedule || entry.schedule.interval !== options.interval)) {
      if (fix) {
        if (!entry.schedule) entry.schedule = {}
        entry.schedule.interval = options.interval
      } else {
        file.message(`Schedule interval should be \`${options.interval}\``, null, 'attend-dependabot:schedule-interval')
      }
    }

    if (entry.ignore != null) {
      if (!Array.isArray(entry.ignore)) {
        file.message('Ignore must be an array', null, 'attend-dependabot:ignore').fatal = true
      } else {
        if (fix) {
          entry.ignore = entry.ignore.filter(Boolean)
        }

        if (entry.ignore.some(e => !e || !e['dependency-name'])) {
          file.message('Expecting `ignore` entries to have a name', null, 'attend-dependabot:ignore').fatal = true
        }
      }
    }
  }

  for (const ecosystem of desiredEcosystems) {
    if (!currentEcosystems.has(ecosystem)) {
      if (fix) {
        file.info(`Adding \`${ecosystem}\` package ecosystem`, null, 'attend-dependabot:ecosystems')
        currentEcosystems.add(ecosystem)
        config.updates.push({
          'package-ecosystem': ecosystem,
          directory: '/',
          schedule: {
            interval: options.interval || 'daily'
          }
        })
      } else {
        file.message(`Add \`${ecosystem}\` package ecosystem`, null, 'attend-dependabot:ecosystems').fatal = true
      }
    }
  }

  for (const ecosystem of currentEcosystems) {
    if (!desiredEcosystems.has(ecosystem)) {
      // Not an error
      file.message(`Found extra \`${ecosystem}\` package ecosystem`, null, 'attend-dependabot:ecosystems')
    }
  }

  // Add additional dependencies to ignore
  // TODO: support removing dependencies as well
  for (const entry of config.updates) {
    const ecosystem = entry['package-ecosystem']
    const ecosystemOptions = (ecosystem && options[ecosystem]) || {}
    const desiredIgnore = ecosystemOptions.ignore ? ecosystemOptions.ignore.slice() : []

    desiredIgnore.push(...guessDesiredIgnore(cwd, project, ecosystem, file, desiredIgnore, entry.ignore || [], files))

    if (!desiredIgnore.length) continue
    if (fix && !entry.ignore) entry.ignore = []

    const ignore = entry.ignore || []
    const missing = []

    for (const name of new Set(desiredIgnore)) {
      // TODO: support objects too (i.e. { dependency-name, version })
      if (typeof name !== 'string') continue
      if (ignore.find(dep => dep && dep['dependency-name'] === name)) continue
      if (!hasDependency(cwd, ecosystem, name)) continue

      if (fix) {
        ignore.push({ 'dependency-name': name })
      } else {
        missing.push(name)
      }
    }

    if (missing.length) {
      file.message(`Incomplete ignore list (${missing.length} missing)`, null, 'attend-dependabot:ignore').fatal = true
    }
  }

  // If we had ecosystems or want to add, then dependabot.yml should exist
  if (config.updates.length > 0 || desiredEcosystems.size > 0) {
    if (!exists && !fix) {
      file.message('File does not yet exist', null, 'attend-dependabot:file').fatal = true
    } else if (fix && !file.messages.some(isFatal) && !deepEqual(prevConfig, config, { strict: true })) {
      // TODO: preserve comments
      const nextYaml = YAML.safeDump(config, { noRefs: true })

      await fsp.mkdir(path.dirname(fp), { recursive: true })
      await fsp.writeFile(fp, nextYaml)
    }
  }

  return { files }
}

async function guessDesiredEcosystems (cwd, project) {
  const desiredEcosystems = new Set()

  if (hasNpmDependencies(cwd)) {
    desiredEcosystems.add('npm')
  }

  if (fs.existsSync(path.join(cwd, '.gitmodules'))) {
    desiredEcosystems.add('gitsubmodule')
  }

  if (await hasFileShallow(cwd, 'Dockerfile')) {
    desiredEcosystems.add('docker')
  }

  if (fs.existsSync(path.join(cwd, '.github', 'workflows'))) {
    desiredEcosystems.add('github-actions')
  }

  return desiredEcosystems
}

async function hasFileShallow (cwd, name) {
  if (fs.existsSync(path.join(cwd, name))) {
    return true
  }

  const files = await fsp.readdir(cwd, { withFileTypes: true })

  for (const dirent of files) {
    if (dirent.isDirectory() && fs.existsSync(path.join(cwd, dirent.name, name))) {
      return true
    }
  }

  return false
}

function isFatal (msg) {
  return msg.fatal
}

// TODO: refactor
function guessDesiredIgnore (cwd, project, ecosystem, file, desiredIgnore, currentIgnore, files) {
  const ignore = []

  function alreadyIgnored (id) {
    return (
      desiredIgnore.includes(id) ||
      currentIgnore.some(dep => dep && dep['dependency-name'] === id)
    )
  }

  if (ecosystem === 'npm') {
    // Reuse info gathered by attend-npm-dependencies
    if (project.data.packages && project.data.packages.npm) {
      for (const item of project.data.packages.npm) {
        if (item.ignoreUpdates) {
          ignore.push(item.id)

          if (!alreadyIgnored(item.id)) {
            file.info(`Ignoring \`${item.id}\` in \`${ecosystem}\``, null, 'attend-dependabot:ignore')
          }
        } else if (item.outdated && !alreadyIgnored(item.id)) {
          file.message(
            `Dependabot will want to bump \`${item.id}\` in \`${ecosystem}\``,
            null,
            'attend-dependabot:no-outdated'
          )
        }
      }
    }

    const pkg = tryReadNpmPackage(cwd)

    // Migrate from defunct greenkeeper
    if (pkg.greenkeeper && Array.isArray(pkg.greenkeeper.ignore)) {
      for (const id of pkg.greenkeeper.ignore) {
        if (id && typeof id === 'string') {
          file.info(`Ignoring \`${id}\` in \`${ecosystem}\``, null, 'attend-dependabot:greenkeeper')
          ignore.push(id)
        }
      }
    }

    if (pkg.greenkeeper) {
      pkg.greenkeeper = undefined

      const fp = path.join(cwd, 'package.json')
      const pfile = vfile({ path: 'package.json', cwd })

      fs.writeFileSync(fp, JSON.stringify(pkg, null, 2) + '\n')

      pfile.info('Removed `greenkeeper` configuration', null, 'attend-dependabot:greenkeeper')
      files.push(pfile)
    }
  }

  return ignore
}

function hasNpmDependencies (cwd) {
  const pkg = tryReadNpmPackage(cwd)

  for (const k of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    if (pkg[k] && Object.keys(pkg[k]).length > 0) return true
  }

  return false
}

function hasDependency (cwd, ecosystem, id) {
  if (ecosystem === 'npm') {
    const pkg = tryReadNpmPackage(cwd)

    for (const k of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      if (pkg[k] && pkg[k][id]) return true
    }

    return false
  }

  return true
}

function tryReadNpmPackage (cwd) {
  try {
    return readNpmPackage(cwd) || {}
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    return {}
  }
}

function readNpmPackage (cwd) {
  // TODO: cache, but just for the lifetime of lint/fix; don't use require()
  // because other attend plugins can change the contents of package.json
  const fp = path.join(cwd, 'package.json')
  const json = fs.readFileSync(fp, 'utf8')

  return JSON.parse(json)
}
