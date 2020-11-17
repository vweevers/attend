'use strict'

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
  let lastStep = ''
  let lastWrite = 0

  function status (line, force) {
    if (verbose) {
      if (line && lastLine !== line) {
        lastLine = line
        console.log(line)
      }
    } else {
      const now = Date.now()

      if (force || now - lastWrite > 150) {
        process.stdout.write(diff.update(line ? `${line}\n` : ''))
        lastWrite = now
      }
    }
  }

  process.stdout.on('resize', function () {
    diff.resize({ width: process.stdout.columns })
    status(lastLine, true)
  })

  process.on('exit', function (code) {
    status(code === 0 ? 'ok' : '', true)
  })

  suite.on('step', function ({ project, name }) {
    lastStep = name
    status(header(project, name))
  })

  suite.on('subprocess', function ({ project, subprocess }) {
    const description = describeSubprocess(subprocess)
    const streams = [subprocess.stdout, subprocess.stderr].filter(Boolean)
    const h = header(project, lastStep, description) + '\n'

    let length = 0

    if (verbose) {
      for (const stream of streams) {
        stream.once('data', function () {
          if (length++ === 0) process.stderr.write(h)
        })
        stream.pipe(process.stderr, { end: false })
      }
    } else {
      status(header(project, lastStep, description))

      // Save output in buffer, only show on failure
      for (const stream of streams) {
        stream.on('data', function (chunk) {
          if (length === 0) buffer.push(Buffer.from(h))
          length += chunk.length
          buffer.push(chunk)
          status(header(project, lastStep, description, 'buffer: ' + bytes.format(length)))
        })
      }
    }
  })

  suite.on('result', function (result) {
    const report = verbose
      ? reporter(result.files, { quiet: false })
      : reporter(result.files.map(stripInfo), { quiet: true })

    if (report) {
      status('', true)

      if (buffer.length) {
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

function stripInfo (file) {
  file.messages = file.messages.filter(notInfo)
  return file
}

function notInfo (msg) {
  return msg.fatal !== null
}

function packageName (cwd) {
  try {
    const fp = path.join(cwd, 'package.json')
    const json = fs.readFileSync(fp, 'utf8')

    return JSON.parse(json).name
  } catch {}
}
