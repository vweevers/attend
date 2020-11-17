'use strict'

const vfile = require('vfile')
const reporter = require('attend-reporter')
const { once, EventEmitter } = require('events')
const path = require('path')
const builtins = require('./builtins')

const kOriginal = Symbol('kOriginal')
const kProjects = Symbol('kProjects')
const kPlugins = Symbol('kPlugins')
const kOpen = Symbol('kOpen')
const kOpened = Symbol('kOpened')
const kFrozen = Symbol('kFrozen')

class Suite extends EventEmitter {
  constructor () {
    super()

    this[kOriginal] = process.cwd()
    this[kProjects] = []
    this[kPlugins] = []
    this[kOpened] = false
    this[kFrozen] = false

    Object.defineProperty(this, 'isAttend', {
      value: true,
      enumerable: false
    })

    builtins.extend(this)
    reporter.report(this)
  }

  get projects () {
    return this[kProjects]
  }

  get plugins () {
    return this[kPlugins]
  }

  async open () {
    if (this[kOpened]) return
    if (this[kFrozen]) return once(this, kOpen)

    this[kFrozen] = true

    if (this[kProjects].length === 0) {
      this[kProjects].push(new LocalProject('.'))
    }

    for (const project of this[kProjects]) {
      if (typeof project.open === 'function') {
        this.emit('step', { project, name: 'open' })
        await project.open()
      }
    }

    this[kOpened] = true
    this.emit(kOpen)
  }

  use (plugin, options) {
    if (this[kFrozen]) {
      throw new Error('Cannot add plugins once frozen')
    }

    if (Array.isArray(plugin)) {
      for (const el of plugin) {
        if (Array.isArray(el)) {
          this.use(el[0], el[1])
        } else {
          this.use(el, options)
        }
      }
    } else if (plugin) {
      if (typeof plugin === 'function') {
        plugin = plugin(options)
      }

      // TODO: instead make it recursive (where a suite is a plugin)
      if (plugin.isAttend) {
        this[kProjects].push(...plugin.projects.map(validateProject))
        this.use(plugin.plugins)
      } else {
        this[kPlugins].push(plugin)

        if (typeof plugin.extend === 'function') {
          plugin.extend(this)
        }

        if (typeof plugin.project === 'function') {
          const project = plugin.project(options)
          this[kProjects].push(validateProject(project))
        }
      }
    }

    return this
  }

  defineHelper (name, fn, options) {
    if (this[kFrozen]) {
      throw new Error('Cannot define helper once frozen')
    }

    options = options || {}

    if (this[name] !== undefined && !options.override) {
      throw new Error(`Helper "${name}" is already defined`)
    }

    this[name] = async (...args) => {
      if (!this[kOpened]) await this.open()

      for (const project of this[kProjects]) {
        this.emit('step', { project, name })

        try {
          await fn(project, ...args)
        } catch (err) {
          this.emit('result', errorResult(err, project, `attend:${name}`))
          process.exit(1)
        }
      }
    }

    return this
  }

  defineTask (name, options) {
    if (this[kFrozen]) {
      throw new Error('Cannot define task once frozen')
    }

    options = options || {}

    if (this[name] !== undefined && !options.override) {
      throw new Error(`Task "${name}" is already defined`)
    }

    this[name] = async (preset = this) => {
      if (!this[kOpened]) await this.open()

      let taskFailed = false

      try {
        for (const project of this[kProjects]) {
          let projectFailed = false

          this.emit('step', { project, name })

          // For compatibility
          process.chdir(project.cwd)

          for (const plugin of preset.plugins) {
            if (typeof plugin[name] !== 'function') {
              continue
            }

            const subs = Subs()
            const onsub = (subprocess) => {
              subs.add(subprocess)

              // If reporter does not consume the streams, we should
              if (!this.emit('subprocess', { subprocess, project })) {
                if (subprocess.stdout) subprocess.stdout.pipe(process.stderr, { end: false })
                if (subprocess.stderr) subprocess.stderr.pipe(process.stderr, { end: false })
              }
            }

            if (typeof plugin.on === 'function') {
              plugin.on('subprocess', onsub)
            }

            let result

            try {
              // TODO: handle input (only for init?)
              result = await plugin[name]({ cwd: project.cwd })
            } catch (err) {
              this.emit('result', errorResult(err, project, `attend:${name}`))
              process.exit(1)
            }

            if (typeof plugin.removeListener === 'function') {
              plugin.removeListener('subprocess', onsub)
            }

            await subs.closed()

            if (!result) {
              // NOTE: temporary for non-compliant plugins
              result = { files: [] }
            }

            this.emit('result', { ...result, project })

            for (const file of result.files) {
              // Stop suite on errors
              if (file.messages.find(isFatal)) process.exit(1)

              // Stop project on warnings
              if (file.messages.find(isWarningOrFatal)) {
                projectFailed = taskFailed = true
                break
              }
            }

            if (projectFailed) break
          }
        }
      } finally {
        process.chdir(this[kOriginal])
      }

      if (taskFailed) process.exit(1)
    }
  }
}

module.exports = function attend () {
  return new Suite()
}

function Subs () {
  let pending = 0

  return { add, closed }

  function add (subprocess) {
    if (subprocess.exitCode === null) {
      pending++
      subprocess.once('close', next)
    }
  }

  function next () {
    if (--pending === 0 && closed.resolve) {
      closed.resolve()
    }
  }

  async function closed () {
    if (pending === 0) return
    return new Promise(function (resolve) {
      closed.resolve = resolve
    })
  }
}

function errorResult (err, project, origin) {
  const file = vfile({ path: '.', cwd: project.cwd })
  const message = file.message(String(err.stack || err), null, origin)

  message.fatal = true

  return { files: [file], project }
}

function isWarningOrFatal (msg) {
  // If .fatal is null, it's an info message
  return msg.fatal === false || msg.fatal === true
}

function isFatal (msg) {
  return msg.fatal === true
}

function validateProject (project) {
  if (typeof project !== 'object' || project === null) {
    throw new TypeError('Project must be an object')
  }

  if (typeof project.cwd !== 'string' || project.cwd === '') {
    throw new TypeError('Project must have a "cwd" property')
  }

  return project
}

class LocalProject {
  constructor (cwd) {
    this.cwd = path.resolve(cwd)
  }
}
