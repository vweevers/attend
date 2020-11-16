'use strict'

const chalk = require('chalk')
const reporter = require('vfile-reporter-pretty')
const fs = require('fs')
const path = require('path')

exports.report = function (suite) {
  const nameCache = new Map()

  let lastHeader = ''

  suite.on('stderr', function ({ stream, project, description }) {
    stream.once('data', () => logHeader(project, description))
    stream.pipe(process.stderr, { end: false })
  })

  suite.on('stdout', function ({ stream, project, description }) {
    stream.once('data', () => logHeader(project, description))
    stream.pipe(process.stdout, { end: false })
  })

  suite.on('result', function (result) {
    const report = reporter(result.files.map(stripInfo), { quiet: true })

    if (report) {
      logHeader(result.project)
      console.error(report.trim())
    }
  })

  function logHeader (project, description) {
    const name = project ? getName(project.cwd) : null
    const header = [name, description].filter(Boolean).join(' | ')

    if (header !== '' && lastHeader !== header) {
      lastHeader = header
      console.error(chalk.bgWhite.black(header))
    }
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
