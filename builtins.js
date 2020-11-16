'use strict'

const promisify = require('util').promisify
const execFile = promisify(require('child_process').execFile)
const headBranchRe = /^\s*HEAD branch:/i

exports.extend = function (suite) {
  suite.defineTask('init')
  suite.defineTask('lint')
  suite.defineTask('fix')

  suite.defineHelper('branch', async function (project, name) {
    if (typeof name !== 'string') {
      throw new TypeError('Branch name must be a string')
    }

    if (!/^[a-z0-9/.\-_]+$/i.test(name)) {
      throw new Error(`Branch name "${name}" is invalid`)
    }

    const from = (await defaultBranch(project.cwd)) || 'main'
    const args = ['checkout', '-B', name, from]

    return execFile('git', args, { cwd: project.cwd })
  })

  suite.defineHelper('fn', async function (project, fn, ...args) {
    return fn(project, ...args)
  })
}

async function defaultBranch (cwd) {
  const args = ['remote', 'show', 'origin']
  const result = await execFile('git', args, { cwd })
  const lines = result.stdout.split(/\r?\n/)
  const line = lines.find(isHeadBranch)

  return line.split(/[: ]+/)[1].trim()
}

function isHeadBranch (line) {
  return headBranchRe.test(line)
}
