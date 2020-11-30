'use strict'

const Githost = require('git-host') // TODO: install
const path = require('path')
const root = process.cwd()

const kCwd = Symbol('kCwd')
const kName = Symbol('kName')
const kData = Symbol('kData')
const kGithost = Symbol('kGithost')
const inspect = Symbol.for('nodejs.util.inspect.custom')

// Slippery slope
class VProject {
  constructor (options) {
    if (typeof options !== 'object' || options === null) {
      throw new TypeError('First argument "options" must be an object')
    }

    const { cwd, name, githost, data } = options

    if (typeof cwd !== 'string' || cwd === '') {
      throw new TypeError('The "cwd" option must be a non-empty string')
    }

    this[kCwd] = path.resolve(root, cwd)
    this[kName] = name || null
    this[kGithost] = githost != null ? Githost.from(githost) : null

    // A place to store custom data
    this[kData] = { ...data }
  }

  get cwd () {
    return this[kCwd]
  }

  get name () {
    let value = this[kName]

    if (value == null) {
      value = this[kGithost] ? this[kGithost].slug() : path.basename(this[kCwd])
      this[kName] = value
    }

    return value
  }

  get data () {
    return this[kData]
  }

  get githost () {
    let value = this[kGithost]

    if (value == null) {
      value = this[kGithost] = Githost.fromDir(this[kCwd])
      this[kName] = null
    }

    return value
  }

  [inspect] (depth, options) {
    if (depth < 0) {
      return `${options.stylize('VProject', 'special')}<${this.name}>`
    } else {
      return {
        name: this.name,
        cwd: this.cwd,
        data: this.data,
        githost: this[kGithost]
      }
    }
  }
}

// Export utilities too
VProject.githost = Githost.from

module.exports = VProject
