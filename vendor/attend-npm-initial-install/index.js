'use strict'

const EventEmitter = require('events')
const spawn = require('child_process').spawn
const path = require('path')
const fs = require('fs')

module.exports = function (pluginOptions) {
  pluginOptions = pluginOptions || {}

  const plugin = new EventEmitter()

  plugin.preinit = plugin.prelint = plugin.prefix = async function (options) {
    const cwd = path.resolve(options.cwd || '.')
    const nm = path.join(cwd, 'node_modules')

    if (!pluginOptions.always && fs.existsSync(nm)) {
      return
    }

    const hasLock = fs.existsSync(path.join(cwd, 'package-lock.json'))

    await new Promise(function (resolve, reject) {
      const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
      const command = pluginOptions.ci ? 'ci' : pluginOptions.it ? 'it' : 'i'

      const env = {
        ...process.env,
        npm_config_audit: String(pluginOptions.audit === true),
        npm_config_build_from_source: String(!!pluginOptions.buildFromSource),
        npm_config_ignore_scripts: String(!!pluginOptions.ignoreScripts),
        npm_config_production: String(!!pluginOptions.production),
        npm_config_progress: 'false',
        npm_config_update_notifier: 'false',
        npm_config_loglevel: 'http',
        npm_config_package_lock: String(!!hasLock),
        ...pluginOptions.env
      }

      const stdio = ['ignore', 'pipe', 'pipe']
      const subprocess = spawn(npm, [command], { cwd, stdio, env })

      if (!plugin.emit('subprocess', subprocess)) {
        subprocess.stdout.pipe(process.stderr, { end: false })
        subprocess.stderr.pipe(process.stderr, { end: false })
      }

      subprocess.on('error', reject)
      subprocess.on('close', function (code) {
        if (code !== 0) return reject(new Error(`npm exited with code ${code}`))
        resolve()
      })
    })
  }

  return plugin
}
