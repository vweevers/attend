'use strict'

const VProject = require('vproject') // TODO: install
const path = require('path')
const fs = require('fs')
const fsp = fs.promises
const root = process.cwd()

module.exports = function factory (options) {
  if (typeof options !== 'object' || options === null) {
    throw new TypeError('Options must be an object')
  }

  if (!options.basedir) {
    throw new Error('The "basedir" option is required')
  }

  const basedir = path.resolve(root, options.basedir)
  const ignore = (options.ignore || []).map(s => s.toLowerCase())
  const only = (options.only || []).map(s => s.toLowerCase())
  const filter = options.filter || {}
  const hasFiles = [].concat(filter.hasFile || [])

  // Exclude by presence of files
  for (const filename of hasFiles) {
    if (!/^[a-z\d.\-_]+$/i.test(filename)) {
      throw new ExpectedError(`Unsafe filename ${JSON.stringify(filename)}`)
    }
  }

  return {
    async projects () {
      const entries = await fsp.readdir(basedir, { withFileTypes: true })

      return entries
        .filter(isDir)
        .map(toCwd)
        .filter(include)
        .map(toProject)

      function isDir (dirent) {
        return dirent.isDirectory()
      }

      function toCwd (dirent) {
        return path.join(basedir, dirent.name)
      }

      function include (cwd) {
        const lbasename = path.basename(cwd).toLowerCase()

        // Exclude by name
        if (ignore.length && ignore.includes(lbasename)) {
          return false
        } else if (lbasename === '.github') {
          return false
        } else if (only.length && !only.includes(lbasename)) {
          return false
        }

        // Exclude by presence of files
        for (const filename of hasFiles) {
          if (!fs.existsSync(path.join(cwd, filename))) return false
        }

        return true
      }

      function toProject (cwd) {
        return new VProject({ cwd })
      }
    }
  }
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
