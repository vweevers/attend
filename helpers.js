'use strict'

const promisify = require('util').promisify
const execFile = promisify(require('child_process').execFile)
const headBranchRe = /^\s*HEAD branch:/i

exports.branch = async function (project, name) {
  if (typeof name !== 'string') {
    throw new TypeError('Branch name must be a string')
  }

  if (!/^[a-z0-9/.\-_]+$/i.test(name)) {
    throw new Error(`Branch name "${name}" is invalid`)
  }

  const from = (await defaultBranch(project.cwd)) || 'main'
  const args = ['checkout', '-B', name, from]

  await execFile('git', args, { cwd: project.cwd })
}

exports.commit = async function (project, message) {
  if (typeof message !== 'string' || message.trim() === '') {
    throw new TypeError('Commit message must be a string')
  }

  await execFile('git', ['add', '-A'], { cwd: project.cwd })

  const changed = await hasStagedChanges(project.cwd)
  if (!changed) return

  const branch = await currentBranch(project.cwd)
  if (!branch) throw new Error('Must be on a branch')

  await execFile('git', ['commit', '-m', message], { cwd: project.cwd })
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

async function hasStagedChanges (cwd) {
  const args = ['diff', '--staged', '--shortstat']
  const result = await execFile('git', args, { cwd })

  return result.stdout.trim() !== ''
}

async function currentBranch (cwd) {
  const args = ['branch', '--show-current']
  const result = await execFile('git', args, { cwd })

  return result.stdout.trim()
}
