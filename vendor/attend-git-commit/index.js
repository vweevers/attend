'use strict'

const promisify = require('util').promisify
const execFile = promisify(require('child_process').execFile)
const kMessage = Symbol('message')

module.exports = function plugin (options) {
  return new Plugin(options)
}

class Plugin {
  constructor (options) {
    const message = typeof options === 'string' ? options : options && options.message

    if (typeof message !== 'string' || message.trim() === '') {
      throw new ExpectedError('Commit message must be a string')
    }

    this[kMessage] = message
  }

  async lint (project) {
    // TODO: return info message if working tree is dirty
  }

  async fix (project) {
    const cwd = project.cwd

    await execFile('git', ['add', '-A'], { cwd })

    const changed = await hasStagedChanges(cwd)
    if (!changed) return

    const branch = await currentBranch(cwd)
    if (!branch) throw new ExpectedError('Must be on a branch')

    await execFile('git', ['commit', '-m', this[kMessage]], { cwd })
  }
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

class ExpectedError extends Error {
  constructor (...args) {
    super(...args)

    Object.defineProperty(this, 'expected', {
      value: true,
      enumerable: false
    })
  }
}
