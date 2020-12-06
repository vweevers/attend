'use strict'

const vfile = require('vfile')
const Githost = require('git-host') // TODO: install
const vsource = require('vsource')
const jsonMap = require('json-source-map')
const path = require('path')
const fs = require('fs')
const fsp = fs.promises

const kRun = Symbol('run')
const kOptions = Symbol('options')
const hasOwnProperty = Object.prototype.hasOwnProperty

module.exports = function (options) {
  return new Plugin(options)
}

class Plugin {
  constructor (options) {
    this[kOptions] = options || {}
  }

  async lint (project) {
    return this[kRun](project, false)
  }

  async fix (project) {
    return this[kRun](project, true)
  }

  async [kRun] (project, fix) {
    const cwd = project.cwd
    const fp = path.join(cwd, 'package.json')

    if (!fs.existsSync(fp)) return

    const contents = await fsp.readFile(fp, 'utf8')
    const pkg = JSON.parse(contents)
    const pos = positions(contents)
    const file = vfile({ path: 'package.json', cwd })
    const type = pkg.repository && pkg.repository.type
    const s = vsource('attend-npm-repository', file)
    const result = { files: [file] }

    if (type && type !== 'git') {
      s.warn(`Incompatible type ${code(type)}`, pos('/repository/type'), 'type')
      return result
    }

    const fromPkg = Githost.fromPkg(pkg, { optional: true })
    const fromGit = Githost.fromGit(cwd, { optional: true })
    const hasRepository = pkg.repository != null

    if (!fromPkg) {
      if (hasRepository) {
        if (this[kOptions].knownHost === false) {
          s.warn('Ignoring unknown git host', pos('/repository/url'), 'known-host')
        } else {
          s.fail('Unknown git host', pos('/repository/url'), 'known-host')
          return result
        }
      } else if (this[kOptions].required === false) {
        if (fromGit.type === 'github') {
          // For compatibility with GitHub Packages, if repository is not set,
          // then the GitHub repository name must match the package name.
          const name = pkg.name.split('/').pop()

          if (fromGit.name !== name) {
            const reason = `Repository name must match package name ${code(name)}`
            s.fail(reason, pos('/name'), 'gh-packages-compat')
          }
        }

        return result
      }
    }

    // Treat git as the source of truth
    // TODO: maybe use project.githost
    const githost = fromGit || fromPkg

    if (!githost) {
      s.warn('Unable to find git host', null, 'available')
      return result
    }

    // Prefer user-provided format, then existing format, then shortest format
    const format = this[kOptions].format || (fromPkg ? fromPkg.format : shortestFormat(githost))
    const expected = githost.toString({ format, committish: false })
    const actual = hasRepository && fromPkg ? fromPkg.raw : null

    if (actual !== expected) {
      if (fix) {
        setRepository(pkg, expected, format)
        await fsp.writeFile(fp, JSON.stringify(pkg, null, 2) + '\n')
      } else if (!hasRepository) {
        s.fail('Add required `repository` field', null, 'required')
      } else {
        s.fail(`Expected ${code(expected)}`, pos('/repository/url'), 'url')
      }
    }

    return result
  }
}

function shortestFormat (githost) {
  // Use "foo/bar" for github or e.g. "gitlab:foo/bar" for others
  return githost.type === 'github' ? 'slug' : 'shortcut'
}

function setRepository (pkg, url, format) {
  if (typeof pkg.repository === 'string' || format === 'slug' || format === 'shortcut') {
    pkg.repository = url
  } else {
    if (isObject(pkg.repository) && !Array.isArray(pkg.repository)) {
      pkg.repository.type = 'git'
      pkg.repository.url = url
    } else {
      pkg.repository = { type: 'git', url }
    }
  }
}

function isObject (obj) {
  return typeof obj === 'object' && obj !== null
}

function positions (contents) {
  let pointers = null

  return function position (path) {
    // Parse lazily
    if (pointers === null) {
      pointers = jsonMap.parse(contents).pointers
    }

    let k = pointerPath(path)
    let pointer = k === '/' ? pointers['/'] : null

    while (pointer == null && k.length > 1) {
      pointer = pointers[k]
      if (pointer) break
      const i = k.lastIndexOf('/')
      k = i > 1 ? k.slice(0, i) : ''
    }

    if (pointer) {
      return {
        start: fixPosition(pointer.key),
        end: fixPosition(pointer.valueEnd)
      }
    }
  }
}

function pointerPath (path) {
  if (Array.isArray(path)) {
    return '/' + path.map(escapePointerKey).join('/')
  } else {
    return path.startsWith('/') ? path : '/' + path
  }
}

function escapePointerKey (key) {
  return key.replace(/\//g, '~1')
}

function code (str) {
  return '`' + str + '`'
}

function fixPosition (pos) {
  const copy = {}

  for (const k in pos) {
    // Is zero-indexed
    if (hasOwnProperty.call(pos, k)) copy[k] = pos[k] + 1
  }

  return copy
}
