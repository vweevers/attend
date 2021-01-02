'use strict'

const vfile = require('vfile')
const jsonMap = require('json-source-map')
const Githost = require('find-githost')
const resolve = require('resolve')
const promisify = require('util').promisify
const execFile = promisify(require('child_process').execFile)
const path = require('path')
const fs = require('fs')
const hasOwnProperty = Object.prototype.hasOwnProperty

exports.init = async function () {
  // TODO: add hallmark to package.json (with script?)
}

exports.lint = async function (project) {
  return wrapHallmark(requireHallmark(project.cwd)).lint({
    // TODO: support disabling reporter in hallmark
    report: { _: [function noop () {}] },
    // TODO: move to hallmark
    repository: Githost.fromDir(project.cwd).https()
  })
}

exports.fix = async function (project) {
  return wrapHallmark(requireHallmark(project.cwd)).fix({
    report: { _: [function noop () {}] },
    repository: Githost.fromDir(project.cwd).https()
  })
}

// Prefer locally installed version of hallmark
function requireHallmark (cwd) {
  let fp

  try {
    fp = resolve.sync('hallmark/package.json', { basedir: cwd })
  } catch (err) {
    const bundled = require('hallmark')
    const contents = tryRead(path.join(cwd, 'package.json'))
    const packageFile = vfile({ path: 'package.json', cwd, contents })
    const pos = contents ? depsPosition(contents) : null

    // We can't fix this, other plugins should
    packageFile.message('Add hallmark to devDependencies', pos, 'attend-hallmark:dev-dependency')

    return {
      async lint (options) {
        const { files } = await bundled.lint(options)
        return { files: files.concat(packageFile) }
      },
      async fix (options) {
        const { files } = await bundled.fix(options)
        return { files: files.concat(packageFile) }
      }
    }
  }

  const pkg = JSON.parse(fs.readFileSync(fp, 'utf8'))
  const version = pkg.version.split('.')
  const major = parseInt(version[0], 10)
  const minor = parseInt(version[1], 10)

  // Didn't have a programmatic API before 3.1.0. Use a JSON
  // reporter and then convert the command line output
  if (major < 3 || (major === 3 && minor < 1)) {
    const bin = path.resolve(path.dirname(fp), pkg.bin.hallmark || pkg.bin)
    const reporter = require.resolve('vfile-reporter-json')
    const contents = tryRead(path.join(cwd, 'package.json'))
    const packageFile = vfile({ path: 'package.json', cwd, contents })
    const pos = contents ? position(contents) : null

    // We can't fix this, other plugins should
    packageFile.message('Bump hallmark to >= 3.1.0 for programmatic API', pos, 'attend-hallmark:bump')

    return {
      async lint (options) {
        const stderr = await execFileLoose(process.execPath, [bin, '--report', reporter], { cwd: options.cwd })
        return { files: [packageFile].concat(JSON.parse(stderr)) }
      },
      async fix (options) {
        const stderr = await execFileLoose(process.execPath, [bin, '--fix', '--report', reporter], { cwd: options.cwd })
        return { files: [packageFile].concat(JSON.parse(stderr)) }
      }
    }
  }

  return require(path.dirname(fp))
}

function wrapHallmark (hallmark) {
  return {
    async lint (...args) {
      const result = await hallmark.lint(...args)

      // TODO: remove noisy info messages from hallmark
      result.files.forEach(stripInfo)
      result.frail = true // Abort on warnings

      return result
    },
    async fix (...args) {
      const result = await hallmark.fix(...args)

      result.files.forEach(stripInfo)
      result.frail = true // Abort on warnings

      return result
    }
  }
}

function tryRead (fp) {
  try {
    return fs.readFileSync(fp, 'utf8')
  } catch {
    return null
  }
}

function position (json) {
  const { pointers } = jsonMap.parse(json)
  const pointer = pointers['/devDependencies/hallmark'] || pointers['/dependencies/hallmark']

  if (pointer) {
    return { start: fixpos(pointer.key), end: fixpos(pointer.valueEnd) }
  }
}

function depsPosition (json) {
  const { pointers } = jsonMap.parse(json)
  const pointer = pointers['/devDependencies']

  if (pointer) {
    return { start: fixpos(pointer.key), end: fixpos(pointer.keyEnd) }
  }
}

function fixpos (pos) {
  for (const k in pos) {
    // Is zero-indexed
    if (hasOwnProperty.call(pos, k)) pos[k] = pos[k] + 1
  }

  return pos
}

async function execFileLoose (...args) {
  try {
    return (await execFile(...args)).stderr
  } catch (err) {
    if (!err.stderr || !err.stderr.startsWith('[')) throw err
    return err.stderr
  }
}

function stripInfo (file) {
  file.messages = file.messages.filter(notInfo)
}

function notInfo (msg) {
  return msg.fatal !== null
}
