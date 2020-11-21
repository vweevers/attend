'use strict'

const path = require('path')
const promisify = require('util').promisify
const execFile = promisify(require('child_process').execFile)
const crypto = require('crypto')
const fs = require('fs')

const kUrl = Symbol('kUrl')
const kDepth = Symbol('kDepth')
const kSparse = Symbol('kSparse')
const kCwd = Symbol('kCwd')
const kDefaultBranch = Symbol('kDefaultBranch')

module.exports = function (pluginOptions) {
  const options = normalizeOptions(pluginOptions)

  return {
    async projects () {
      return [new ProjectClone(options)]
    }
  }
}

// TODO: make an abstract interface?
class ProjectClone {
  constructor (options) {
    options = normalizeOptions(options)

    this[kUrl] = `git@github.com:${options.slug}.git`
    this[kDepth] = options.depth || Infinity
    this[kSparse] = options.sparse
    this[kCwd] = location(this[kDepth], this[kSparse], options.slug)
    this[kDefaultBranch] = options.defaultBranch || null
  }

  get cwd () {
    return this[kCwd]
  }

  get defaultBranch () {
    return this[kDefaultBranch]
  }

  async open () {
    if (!fs.existsSync(this[kCwd])) {
      const cloneArgs = this[kDepth] < Infinity ? [`--depth=${this[kDepth]}`] : []

      // Requires git >= 2.25
      if (this[kSparse]) {
        await execFile('git', ['clone', ...cloneArgs, '--no-checkout', this[kUrl], this[kCwd]])
        await execFile('git', ['sparse-checkout', 'init', '--cone'], { cwd: this[kCwd] })

        if (Array.isArray(this[kSparse]) && this[kSparse].length > 0) {
          // Checkout additional subdirectories
          await execFile('git', ['sparse-checkout', 'set', ...this[kSparse]], { cwd: this[kCwd] })
        }
      } else {
        await execFile('git', ['clone', ...cloneArgs, '--recurse-submodules', this[kUrl], this[kCwd]])
      }
    }
  }
}

function normalizeOptions (options) {
  if (typeof options === 'string') {
    options = { slug: options }
  }

  if (typeof options !== 'object' || options === null) {
    throw new TypeError('Options must be an object or string shorthand')
  }

  if (typeof options.slug !== 'string') {
    throw new TypeError('The "slug" option is required and must be a string')
  }

  if (!/^[a-z0-9-_.]+\/[a-z0-9-_.]+$/i.test(options.slug)) {
    const json = JSON.stringify(options.slug)
    throw new Error(`The "slug" option must be in the form of "owner/name", got ${json}`)
  }

  if (options.defaultBranch && typeof options.defaultBranch !== 'string') {
    throw new TypeError('The "defaultBranch" option must be a string')
  }

  return options
}

function location (depth, sparse, slug) {
  const root = path.resolve('.attend')
  const subfolder = slug.toLowerCase()

  if (depth < Infinity || sparse) {
    const json = JSON.stringify([depth, sparse])
    const hash = crypto.createHash('sha1').update(json).digest('hex').slice(0, 10)

    return path.join(root, '.partial', hash, subfolder)
  } else {
    return path.join(root, subfolder)
  }
}
