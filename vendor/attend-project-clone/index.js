'use strict'

const VProject = require('vproject') // TODO: install
const path = require('path')
const promisify = require('util').promisify
const execFile = promisify(require('child_process').execFile)
const filenamify = require('filenamify')
const crypto = require('crypto')
const fs = require('fs')

const kDepth = Symbol('kDepth')
const kSparse = Symbol('kSparse')

module.exports = function (pluginOptions) {
  const project = new ProjectClone(pluginOptions)

  return {
    async projects () {
      return [project]
    }
  }
}

class ProjectClone extends VProject {
  constructor (options) {
    if (typeof options === 'string') {
      options = { githost: options }
    } else if (typeof options !== 'object' || options === null) {
      throw new TypeError('Options must be an object or string shorthand')
    }

    const githost = VProject.githost(options.githost)
    const depth = options.depth || Infinity
    const sparse = options.sparse
    const cwd = location(depth, sparse, githost)

    super({ ...options, cwd, githost })

    this[kDepth] = depth
    this[kSparse] = sparse
  }

  async open () {
    if (!fs.existsSync(this.cwd)) {
      const url = this.githost.ssh({ committish: null })
      const cloneArgs = this[kDepth] < Infinity ? [`--depth=${this[kDepth]}`] : []

      // Requires git >= 2.25
      if (this[kSparse]) {
        await execFile('git', ['clone', ...cloneArgs, '--no-checkout', url, this.cwd])
        await execFile('git', ['sparse-checkout', 'init', '--cone'], { cwd: this.cwd })

        // Sparse can be boolean or an array
        if (Array.isArray(this[kSparse]) && this[kSparse].length > 0) {
          // Checkout additional subdirectories
          await execFile('git', ['sparse-checkout', 'set', ...this[kSparse]], { cwd: this.cwd })
        }
      } else {
        await execFile('git', ['clone', ...cloneArgs, '--recurse-submodules', url, this.cwd])
      }
    }
  }
}

module.exports.ProjectClone = ProjectClone

function location (depth, sparse, githost) {
  const root = path.resolve('.attend')
  const type = strong(filenamify(githost.type), 'The "type" filename')
  const owner = strong(filenamify(githost.owner), 'The "owner" filename')
  const name = strong(filenamify(githost.name), 'The "name" filename')
  const subfolder = path.join(type, owner, name)

  if (depth < Infinity || sparse) {
    const json = JSON.stringify([depth, sparse])
    const hash = crypto.createHash('sha1').update(json).digest('hex').slice(0, 10)

    return path.join(root, '.partial', hash, subfolder)
  } else {
    return path.join(root, '.complete', subfolder)
  }
}

function strong (str, name) {
  if (typeof str !== 'string' || str === '') {
    throw new TypeError(`${name || 'Argument'} must be a non-empty string`)
  }

  return str
}
