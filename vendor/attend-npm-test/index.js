'use strict'

const vfile = require('vfile')
const spawn = require('child_process').spawn
const EventEmitter = require('events')
const path = require('path')
const fsp = require('fs').promises

module.exports = function (pluginOptions) {
  const plugin = new EventEmitter()

  plugin.init = async function (options) {
    const cwd = path.resolve(options.cwd || '.')
    const fp = path.join(cwd, 'package.json')
    const pkg = JSON.parse(await fsp.readFile(fp, 'utf8'))

    if (!pkg.scripts || !pkg.scripts.test) {
      if (!pkg.scripts) pkg.scripts = {}
      pkg.scripts.test = 'node test.js'

      return Promise.all([
        fsp.writeFile(fp, JSON.stringify(pkg, null, 2)),
        fsp.appendFile(path.join(cwd, 'test.js'), '')
      ])
    }
  }

  plugin.lint = async function (options) {
    const cwd = path.resolve(options.cwd || '.')
    const code = await npmt(cwd, plugin)
    const file = vfile({ path: '.', cwd })

    if (code !== 0) {
      file.message(`npm test failed`, null, `attend-npm-test:test`).fatal = true
    }

    return { files: [file] }
  }

  plugin.fix = function (options) {
    // Can't fix
    return plugin.lint(options)
  }

  return plugin
}

function npmt (cwd, ee) {
  return new Promise(function (resolve, reject) {
    const stdio = ['ignore', 'pipe', 'pipe']
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    const subprocess = spawn(npm, ['run', '-s', 'test'], { cwd, stdio })

    if (!ee.emit('subprocess', subprocess)) {
      subprocess.stdout.pipe(process.stderr, { end: false })
      subprocess.stderr.pipe(process.stderr, { end: false })
    }

    subprocess.on('error', reject)
    subprocess.on('close', resolve)
  })
}
