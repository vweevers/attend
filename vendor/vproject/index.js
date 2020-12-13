'use strict'

const path = require('path')
const root = process.cwd()

const kCwd = Symbol('kCwd')
const kData = Symbol('kData')

// Slippery slope
class VProject {
  constructor (options) {
    if (typeof options !== 'object' || options === null) {
      throw new TypeError('First argument "options" must be an object')
    }

    const { cwd, data } = options

    if (typeof cwd !== 'string' || cwd === '') {
      throw new TypeError('The "cwd" option must be a non-empty string')
    }

    this[kCwd] = path.resolve(root, cwd)

    // A place to store custom data
    this[kData] = { ...data }
  }

  get cwd () {
    return this[kCwd]
  }

  get data () {
    return this[kData]
  }
}

module.exports = VProject
