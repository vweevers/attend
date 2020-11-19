'use strict'

patchWindowsTerminal()

const style = require('chalk').bgWhite.black
const bytes = require('bytes')
const reporter = require('vfile-reporter-pretty')
const ansiDiff = require('ansi-diff')
const fs = require('fs')
const path = require('path')

exports.report = function (suite) {
  const nameCache = new Map()
  const verbose = !!process.env.CI
  const diff = ansiDiff({ width: process.stdout.columns })
  const buffer = []

  let lastLine = ''
  let lastWrite = 0
  let timer = null

  function status (line, force) {
    if (verbose) {
      if (line && lastLine !== line) {
        console.log(line)
      }
    } else {
      const now = Date.now()

      if (force || now - lastWrite > 150) {
        clearTimeout(timer)
        timer = null
        process.stdout.write(diff.update(line ? `${line}\n` : ''))
        lastWrite = now
      } else if (timer === null) {
        timer = setTimeout(refresh, 250)
        timer.unref()
      }
    }

    lastLine = line
  }

  function refresh () {
    status(lastLine)
  }

  process.stdout.on('resize', function () {
    diff.resize({ width: process.stdout.columns })
    status(lastLine, true)
  })

  process.on('exit', function (code) {
    status(code === 0 ? 'ok' : '', true)
  })

  suite.on('step', function ({ project, name }) {
    status(header(project, name))
  })

  suite.on('subprocess', function ({ project, step, subprocess }) {
    const description = describeSubprocess(subprocess)
    const streams = [subprocess.stdout, subprocess.stderr].filter(Boolean)
    const h = header(project, step, description) + '\n'

    let length = 0

    if (verbose) {
      for (const stream of streams) {
        stream.once('data', function () {
          if (length++ === 0) process.stderr.write(h)
        })
        stream.pipe(process.stderr, { end: false })
      }
    } else {
      status(header(project, step, description))

      // Save output in buffer, only show on failure
      for (const stream of streams) {
        stream.on('data', function (chunk) {
          if (length === 0) buffer.push(Buffer.from(h))
          length += chunk.length
          buffer.push(chunk)
          status(header(project, step, description, 'buffer: ' + bytes.format(length)))
        })
      }
    }
  })

  suite.on('result', function (result) {
    const report = reporter(result.files, { quiet: !verbose })

    if (report) {
      status('', true)

      if (buffer.length && result.files.some(hasWarningOrFatal)) {
        process.stderr.write(Buffer.concat(buffer))
        process.stderr.write('\n')
      }

      console.error(header(result.project))
      console.error(report.trim())
    }

    buffer.length = 0
  })

  function header (project, ...extra) {
    const name = project ? getName(project.cwd) : null
    const line = [name, ...extra].filter(Boolean).join(' | ')

    return line === '' ? '' : style(line)
  }

  function getName (cwd) {
    let name = nameCache.get(cwd)

    if (name == null) {
      name = packageName(cwd) || path.basename(cwd)
      nameCache.set(cwd, name)
    }

    return name
  }
}

function describeSubprocess (subprocess) {
  let file = path.basename(subprocess.spawnfile)
  let args = subprocess.spawnargs

  if (process.platform === 'win32') {
    file = file.replace(/\.(cmd|exe|bat)$/i, '')

    if (args.length) {
      args = args.slice()
      args[0] = args[0].replace(/\.(cmd|exe|bat)$/i, '')
      if (args[0] === file) args.shift()
    }
  }

  return [file, ...args].join(' ')
}

function packageName (cwd) {
  try {
    const fp = path.join(cwd, 'package.json')
    const json = fs.readFileSync(fp, 'utf8')

    return JSON.parse(json).name
  } catch {}
}

function hasWarningOrFatal (file) {
  return file.messages.find(isWarningOrFatal)
}

function isWarningOrFatal (msg) {
  // If .fatal is null, it's an info message
  return msg.fatal === false || msg.fatal === true
}

// Enable unicode in Windows Terminal as well as ConEmu
function patchWindowsTerminal () {
  try {
    if (process.platform !== 'win32') return
    if (!process.env.WT_SESSION && !process.env.ConEmuDir) return

    // Hack to do https://github.com/sindresorhus/log-symbols/pull/24
    const reporter = require.resolve('vfile-reporter-pretty/package.json')
    const basedir = require('path').dirname(reporter)
    const symbolsPath = require.resolve('log-symbols', { paths: [basedir] })
    const symbols = require(symbolsPath)
    const chalk = require('chalk')

    symbols.info = chalk.blue('ℹ')
    symbols.success = chalk.green('✔')
    symbols.warning = chalk.yellow('⚠')
    symbols.error = chalk.red('✖')
  } catch {
    // Ignore
  }
}
