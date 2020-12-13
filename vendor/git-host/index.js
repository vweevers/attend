'use strict'

const hostedGitInfo = require('hosted-git-info')
const remoteOrigin = require('remote-origin-url')
const validRef = require('is-git-ref-name-valid')
const validBranch = require('is-git-branch-name-valid')
const gitdir = require('find-gitdir')
const find = require('find-file-up')
const path = require('path')
const fs = require('fs')

const kShell = Symbol('shell')
const kNut = Symbol('nut')
const kRaw = Symbol('raw')
const kFormat = Symbol('format')
const kIsGithost = Symbol.for('githost.is')
const kGithostOptions = Symbol.for('githost.options')
const inspect = Symbol.for('nodejs.util.inspect.custom')
const formats = new Set(['shortcut', 'slug', 'https', 'ssh', 'sshurl', 'git'])

exports.fromUrl = function (url, options) {
  options = getOptions(options)
  return parse(strong(url, 'The first argument "url"'), options)
}

exports.fromDir = function (cwd, options) {
  cwd = path.resolve(strong(cwd, 'The first argument "cwd"'))
  options = getOptions(options)

  // Opt-in to reading parent directories
  const roam = !!options.roam
  const opt = { ...options, roam: false, optional: true }

  // Check directory by directory because a directory may have a gitdir and
  // also a parent directory with a package.json. The gitdir should win.
  let candidate = cwd
  let previous

  do {
    let info = exports.fromPkg(findPkg(candidate, opt), opt)
    if (info != null) return info

    info = exports.fromGit(candidate, opt)
    if (info != null) return info

    previous = candidate
    candidate = path.dirname(candidate)
  } while (
    // eslint-disable-next-line no-unmodified-loop-condition
    roam && candidate !== previous
  )

  if (options.optional) {
    return null
  }

  throw new Error(`Unable to find git host in directory ${s(cwd)}`)
}

exports.fromPkg = function (pkg, options) {
  options = getOptions(options)

  if (pkg != null && pkg.repository != null) {
    if (typeof pkg.repository === 'string') {
      const url = strong(pkg.repository, 'The "repository" in package.json')
      return parse(url, options)
    }

    let { type, url } = pkg.repository

    if (type != null && type !== 'git') {
      throw new Error(
        `The "repository.type" in package.json is unsupported: ${s(type)}`
      )
    }

    if (url != null) {
      url = strong(url, 'The "repository.url" in package.json')
      return parse(url, options)
    }
  }

  return parse(null, options)
}

exports.fromGit = function (cwd, options) {
  options = getOptions(options)

  const git = gitdir.sync(cwd, !!options.roam)
  const url = git ? remoteOrigin.sync({ cwd: git, path: 'config' }) : null

  return parse(url, options)
}

exports.from = function (value, options) {
  if (typeof value === 'string') {
    return exports.fromUrl(value, options)
  } else if (value != null && value[kIsGithost] === true) {
    options = fromOptions(value[kGithostOptions], options)
    return exports.fromUrl(value.toString(), options)
  } else if (value != null && value.url != null) {
    return exports.fromUrl(value.url, fromOptions(value, options))
  } else if (value != null && value.pkg != null) {
    return exports.fromPkg(value.pkg, fromOptions(value, options))
  } else if (value != null && value.cwd != null) {
    return exports.fromDir(value.cwd, fromOptions(value, options))
  } else {
    const name = 'First argument "value"'
    const obj = 'an object with "url", "cwd" or "pkg"'
    const actual = JSON.stringify(value)

    throw new TypeError(`${name} must be a string, GitHost or ${obj}, got ${actual}`)
  }
}

exports.formats = Array.from(formats)

function fromOptions (value, options) {
  const { url, pkg, cwd, ...rest } = value
  return { ...rest, ...options }
}

function getOptions (options) {
  return options == null ? {} : options
}

function parse (url, options) {
  if (!url) {
    if (options.optional) return null
    throw new Error('Unable to find git host')
  }

  // Note: has a semiglobal cache
  const xopts = { __cacheBuster: options }
  const nut = hostedGitInfo.fromUrl(url, xopts)

  if (!nut) {
    if (options.optional) return null
    throw new Error(`Unable to parse git host url ${s(url)}`)
  }

  if (nut[kShell] == null) {
    definePrivate(nut, kShell, new GitHost(url, nut, options))
  }

  return nut[kShell]
}

function getFormat (url, nut) {
  return url === `${nut.user}/${nut.project}` ? 'slug' : nut.default || 'ssh'
}

class GitHost {
  constructor (url, nut, options) {
    definePrivate(this, kRaw, url)
    definePrivate(this, kNut, nut)
    definePrivate(this, kFormat, getFormat(url, nut))
    definePrivate(this, kIsGithost, true)
    definePrivate(this, kGithostOptions, options)

    this.type = nut.type
    this.owner = nut.user
    this.name = nut.project
    this.committish = optionalCommittish(nut, options) || null
    this.defaultBranch = options.defaultBranch
      ? assertBranch(options.defaultBranch)
      : null
  }

  get raw () {
    return this[kRaw]
  }

  get format () {
    return this[kFormat]
  }

  file (path, opts) {
    if (typeof path !== 'string') {
      throw new TypeError('First argument "path" must be a string')
    }

    return this[kNut].file(path, {
      committish: requireCommittish(this, opts)
    })
  }

  shortcut (opts) {
    return this[kNut].shortcut({
      committish: optionalCommittish(this, opts)
    })
  }

  slug () {
    if (this.type !== 'github') {
      const json = JSON.stringify(this.type)
      throw new Error(`The slug format is not supported on type ${json}`)
    }

    return `${this.owner}/${this.name}`
  }

  homepage () {
    return this[kNut].browse({ committish: '' })
  }

  browse (path, fragment, opts) {
    if (typeof path === 'object' && path !== null) {
      return this.browse(null, null, path)
    } else if (typeof fragment === 'object' && fragment !== null) {
      return this.browse(path, null, fragment)
    } else if (path) {
      if (typeof path !== 'string') {
        throw new TypeError('First argument "path" must be a string')
      }

      if (fragment && typeof fragment !== 'string') {
        throw new TypeError('Second argument "fragment" must be a string')
      }

      return this[kNut].browse(path, fragment || '', {
        committish: requireCommittish(this, opts)
      })
    } else {
      return this[kNut].browse({
        committish: optionalCommittish(this, opts)
      })
    }
  }

  bugs () {
    return this[kNut].bugs()
  }

  https (opts) {
    return this[kNut].https({
      noGitPlus: true,
      committish: optionalCommittish(this, opts)
    })
  }

  ssh (opts) {
    return this[kNut].ssh({
      committish: optionalCommittish(this, opts)
    })
  }

  sshurl (opts) {
    return this[kNut].sshurl({
      committish: optionalCommittish(this, opts)
    })
  }

  git (opts) {
    return this.https(opts).replace(/^(git\+)?https:/, 'git:')
  }

  tarball (opts) {
    return this[kNut].tarball({
      committish: requireCommittish(this, opts)
    })
  }

  toString (opts) {
    const format = (opts && opts.format) || this.format

    if (!formats.has(format)) {
      const expected = Array.from(formats).map(s => JSON.stringify(s)).join(', ')
      const actual = JSON.stringify(format)

      throw new Error('The "format" option must be one of ' + expected + ', got ' + actual)
    }

    return this[format](opts)
  }

  [inspect] (depth, options) {
    if (depth < 0) {
      return `${options.stylize('GitHost', 'special')}<${this.shortcut()}>`
    } else {
      const { type, owner, name, committish, defaultBranch } = this
      return { type, owner, name, committish, defaultBranch }
    }
  }
}

function requireCommittish (githost, opts) {
  if (opts && opts.committish) {
    return assertCommittish(opts.committish)
  } else {
    return githost.committish || githost.defaultBranch || 'main'
  }
}

function optionalCommittish (githost, opts) {
  if (opts && opts.committish !== undefined) {
    return opts.committish ? assertCommittish(opts.committish) : ''
  } else {
    return githost.committish || ''
  }
}

function assertCommittish (committish) {
  if (typeof committish !== 'string') {
    throw new TypeError('Committish must be a string')
  } else if (!validRef(committish, true)) {
    throw new TypeError('Committish must be a valid git reference name')
  }

  return committish
}

function assertBranch (name) {
  if (typeof name !== 'string') {
    throw new TypeError('Branch name must be a string')
  } else if (!validBranch(name)) {
    throw new TypeError('Branch name must be a valid git branch name')
  }

  return name
}

function findPkg (cwd, options) {
  const name = 'package.json'
  const fp = options.roam ? find.sync(name, cwd) : path.join(cwd, name)
  const json = fp ? tryRead(fp) : null

  return json ? JSON.parse(json) : null
}

function tryRead (fp) {
  try {
    return fs.readFileSync(fp, 'utf8')
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
}

function definePrivate (obj, symbol, value) {
  Object.defineProperty(obj, symbol, { value, enumerable: false })
}

function strong (str, name) {
  if (typeof str !== 'string' || str === '') {
    throw new TypeError(
      `${name || 'Argument'} must be a non-empty string, got ${typeHint(str)}`
    )
  }

  return str
}

function typeHint (value) {
  if (typeof value === 'undefined') {
    return 'undefined'
  } else {
    return `${typeof value} ${s(value)}`
  }
}

function s (str) {
  return JSON.stringify(str)
}
