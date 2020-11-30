'use strict'

const vfile = require('vfile')
const reporter = require('attend-reporter')
const VProject = require('vproject')
const EventEmitter = require('events')
const helpers = require('./helpers')

const kPlugins = Symbol('kPlugins')
const kRun = Symbol('kRun')
const kStep = Symbol('kStep')

class Suite extends EventEmitter {
  constructor () {
    super()
    this[kPlugins] = []
    reporter.report(this)
  }

  get plugins () {
    return this[kPlugins]
  }

  use (plugin, options) {
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

      if (plugin.plugins) {
        this[kPlugins].push(...plugin.plugins)
      } else {
        this[kPlugins].push(plugin)
      }
    }

    return this
  }

  async [kRun] (steps) {
    const original = process.cwd()
    const projects = []

    let defaultProject = true

    for (const plugin of this[kPlugins]) {
      if (typeof plugin.projects === 'function') {
        defaultProject = false
        projects.push(...(await plugin.projects()).map(validateProject))
      }
    }

    if (defaultProject) {
      projects.push(new VProject({ cwd: '.' }))
    }

    let passed = projects.length

    for (const project of projects) {
      try {
        await this[kStep](project, 'open', openProject)

        // For compatibility
        process.chdir(project.cwd)
      } catch (err) {
        this.emit('result', errorResult(err, project, 'attend:open'))
        passed--
        continue
      }

      try {
        for (const { name, work, plugin } of steps) {
          try {
            const ret = await this[kStep](project, name, work, plugin)
            const result = ret ? { ...ret, project } : { files: [], project }

            // For consistency always emit result even if empty
            this.emit('result', result)

            // Stop project on warnings if frail is true
            if (result.files.some(result.frail ? hasWarningOrFatal : hasFatal)) {
              passed--
              break
            }
          } catch (err) {
            this.emit('result', errorResult(err, project, `attend:${name}`))
            passed--
            break
          }
        }
      } finally {
        process.chdir(original)
      }
    }

    this.emit('end', {
      planned: projects.length,
      failed: projects.length - passed,
      passed
    })

    if (passed !== projects.length) process.exit(1)
  }

  async [kStep] (project, step, work, plugin) {
    this.emit('step', { project, name: step })

    const subs = Subs()
    const ee = plugin ? typeof plugin.on === 'function' : false
    const onsub = (subprocess) => {
      subs.add(subprocess)

      // If reporter does not consume the streams, we should.
      // TODO: don't emit on suite, but on ...?
      if (!this.emit('subprocess', { project, step, subprocess })) {
        if (subprocess.stdout) subprocess.stdout.pipe(process.stderr, { end: false })
        if (subprocess.stderr) subprocess.stderr.pipe(process.stderr, { end: false })
      }
    }

    try {
      if (ee) plugin.on('subprocess', onsub)
      return await work.call(plugin, project)
    } finally {
      if (ee) plugin.removeListener('subprocess', onsub)
      await subs.closed()
    }
  }
}

// TODO: handle input (only for init?)
for (const k of ['init', 'lint', 'fix']) {
  Suite.prototype[k] = async function (options) {
    if (!options) options = {}

    const steps = []

    if (options.branch) {
      const work = async (project) => helpers.branch(project, options.branch)
      steps.push({ name: 'branch', work })
    }

    for (const prefix of ['pre', '', 'post']) {
      const name = prefix + k

      for (const plugin of this[kPlugins]) {
        const work = plugin[name]

        if (typeof work === 'function') {
          steps.push({ name, work, plugin })
        }
      }
    }

    if (options.commit) {
      const work = async (project) => helpers.commit(project, options.commit)
      steps.push({ name: 'commit', work })
    }

    if (options.pr) {
      const work = async (project) => helpers.pr(project, options.pr)
      steps.push({ name: 'pr', work })
    }

    return this[kRun](steps)
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
  // TODO: vfile supports a .stack property, use that
  const file = vfile({ path: '.', cwd: project.cwd })
  const reason = String(err.expected ? err.message || err : err.stack || err)
  const message = file.message(reason, null, origin)

  message.fatal = true

  return { files: [file], project }
}

async function openProject (project) {
  if (typeof project.open === 'function') {
    await project.open()
  }
}

function hasWarningOrFatal (file) {
  return file.messages.some(isWarningOrFatal)
}

function isWarningOrFatal (msg) {
  // If .fatal is null, it's an info message
  return msg.fatal === false || msg.fatal === true
}

function hasFatal (file) {
  return file.messages.some(isFatal)
}

function isFatal (msg) {
  return msg.fatal
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
