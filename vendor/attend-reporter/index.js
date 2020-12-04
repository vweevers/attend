'use strict'

const chalk = require('chalk')
const bytes = require('bytes')
const reporter = require('vfile-reporter-shiny')
const ansiDiff = require('ansi-diff')
const path = require('path')
const fs = require('fs')
const root = process.cwd()

exports.report = function (suite) {
  const verbose = !!process.env.CI
  const diff = ansiDiff({ width: process.stdout.columns })
  const headerPre = chalk.grey('| ')
  const headerSep = chalk.grey(' | ')
  const buffer = []
  const failedProjects = new Set()

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

  function clearStatus () {
    status('', true)
  }

  process.stdout.on('resize', function () {
    diff.resize({ width: process.stdout.columns })
    status(lastLine, true)
  })

  process.on('exit', clearStatus)

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
    const cwd = result.project.cwd
    const report = reporter(result.files, { quiet: !verbose, cwd })

    if (!result.passed) {
      failedProjects.add(cwd)
    }

    if (report) {
      clearStatus()

      if (buffer.length && result.files.some(hasFatal)) {
        process.stderr.write(Buffer.concat(buffer))
        process.stderr.write('\n')
      }

      console.error(header(result.project))
      console.error(report)
    }

    buffer.length = 0
  })

  suite.on('end', function ({ planned, passed, failed }) {
    clearStatus()
    process.removeListener('exit', clearStatus)

    if (planned > 1) {
      console.log()
      console.log(chalk.green(`  ${passed} projects passed`))
      console.log(chalk[failed ? 'red' : 'grey'](`  ${failed} projects failed`))

      const dir = path.join(root, '.attend', '.report')
      const fp = path.join(dir, 'failed-projects')

      if (failedProjects.size > 0) {
        fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(fp, Array.from(failedProjects).join('\n') + '\n')
      } else {
        unlink(fp)
      }
    }
  })

  function header (project, ...extra) {
    const name = project.name || '(anonymous)'
    const arr = [name, ...extra].filter(Boolean)

    return arr.length > 0 ? headerPre + arr.join(headerSep) : ''
  }
}

function unlink (fp) {
  try {
    fs.unlinkSync(fp)
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
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

function hasFatal (file) {
  return file.messages.some(isFatal)
}

function isFatal (msg) {
  return msg.fatal
}
