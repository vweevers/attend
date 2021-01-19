'use strict'

const promisify = require('util').promisify
const validBranch = require('is-git-branch-name-valid')
const execFile = promisify(require('child_process').execFile)

const kName = Symbol('name')
const kRun = Symbol('run')
const headBranchRe = /^\s*HEAD branch:/i

module.exports = function plugin (options) {
  return new Plugin(options)
}

class Plugin {
  constructor (options) {
    const name = typeof options === 'string' ? options : options && options.name

    if (typeof name !== 'string') {
      throw new ExpectedError('Branch name must be a string')
    }

    if (!validBranch(name)) {
      const json = JSON.stringify(name)
      throw new ExpectedError(`Name ${json} must be a valid git branch name`)
    }

    this[kName] = name
  }

  async fix (project) {
    return this[kRun](project)
  }

  async [kRun] (project) {
    const cwd = project.cwd
    const current = await currentBranch(cwd)

    if (current !== this[kName]) {
      const def = await defaultBranch(cwd)

      if (this[kName] === def) {
        await execFile('git', ['checkout', this[kName]], { cwd })
        await execFile('git', ['pull'], { cwd })
      } else {
        // TODO: only add --recurse-submodules=no if checkout is sparse
        await execFile('git', ['fetch', '--tags', '--recurse-submodules=no'], { cwd })
        await execFile('git', ['checkout', '--no-track', '-b', this[kName], 'origin/' + def], { cwd })
      }
    }
  }
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
