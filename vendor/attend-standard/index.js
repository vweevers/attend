'use strict'

const vfile = require('vfile')
const resolve = require('resolve')
const path = require('path')
const promisify = require('util').promisify

exports.init = async function () {
  // TODO: add standard to package.json (with script)
}

exports.lint = async function (options) {
  return run(options, false)
}

exports.fix = async function (options) {
  return run(options, true)
}

async function run (options, fix) {
  const cwd = path.resolve(options.cwd || '.')
  const standard = requireStandard(cwd)
  const lintFiles = promisify(standard.lintFiles.bind(standard))
  const results = await lintFiles(['**/*.{js,jsx}'], { cwd, fix })
  const files = results.results.map(result => eslintToVFile(result, cwd))

  return { files }
}

function eslintToVFile (result, cwd) {
  const file = vfile({ path: result.filePath, cwd })

  for (const theirs of result.messages) {
    const start = { line: theirs.line, column: theirs.column }
    const end = { line: theirs.endLine, column: theirs.endColumn }
    const ours = file.message(theirs.message, { start, end }, `eslint:${theirs.ruleId}`)

    if (theirs.severity === 2) ours.fatal = true
  }

  return file
}

// Prefer locally installed version of standard
function requireStandard (cwd) {
  try {
    return require(resolve.sync('standard', { basedir: cwd }))
  } catch {
    return require('standard')
  }
}
