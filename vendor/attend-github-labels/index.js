'use strict'

const vfile = require('vfile')
const githubLabelSync = require('github-label-sync')
const Githost = require('git-host') // TODO: install

module.exports = function (options) {
  if (Array.isArray(options)) {
    options = { preset: options }
  } else if (!options) {
    options = {}
  }

  const token = options.token || process.env.GITHUB_TOKEN
  const labels = mergePreset(options.preset)

  if (!token) {
    const hint = 'required scopes: public_repo or repo'
    throw new ExpectedError(`Please set options.token or GITHUB_TOKEN in the environment (${hint})`)
  }

  return {
    async lint (project) {
      return run(project, false)
    },
    async fix (project) {
      return run(project, true)
    }
  }

  async function run (project, fix) {
    const cwd = project.cwd
    const file = vfile({ path: '.', cwd })
    const githost = Githost.fromGit(cwd)

    if (githost.type !== 'github') {
      const rule = 'attend-github-labels:git-host'
      file.info(`Skipping git host \`${githost.type}\``, null, rule)
      return { files: [file] }
    }

    try {
      const diff = await githubLabelSync({
        repo: githost.slug(),
        accessToken: token,
        labels,
        // In lint mode, warn about extra labels. Don't remove them in fix mode
        allowAddedLabels: fix,
        dryRun: !fix
      })

      if (!fix) {
        lintDiff(file, diff)
      }
    } catch (err) {
      let error = err

      if (err.endpoint) {
        error = new ExpectedError(`GitHub error:\n${err.method} ${err.endpoint}\n${err.statusCode}: ${err.message}`)
      }

      file.message(error, null, 'attend-github-labels:sync').fatal = true
    }

    return { files: [file] }
  }
}

function lintDiff (file, diff) {
  for (const entry of diff) {
    if (entry.type === 'missing') {
      file.message(`Label \`${entry.name}\` is missing`, null, 'attend-github-labels:no-missing').fatal = true
    } else if (entry.type === 'changed') {
      const hints = []

      if (entry.expected.name !== entry.actual.name) {
        hints.push('name')
      }

      if (entry.expected.color !== entry.actual.color) {
        hints.push('color')
      }

      if (entry.expected.description && entry.expected.description !== entry.actual.description) {
        hints.push('description')
      }

      const hint = hints.length ? `has different ${hints.join(', ')}` : 'is different'
      const reason = `Label \`${entry.expected.name}\` ${hint}`

      file.message(reason, null, 'attend-github-labels:no-difference').fatal = true
    } else if (entry.type === 'added') {
      file.message(`Label \`${entry.name}\` is extraneous`, null, 'attend-github-labels:no-extraneous')
    } else {
      file.message(`Unknown diff type \`${entry.type}\``, null).fatal = true
    }
  }
}

function mergePreset (preset) {
  if (!Array.isArray(preset)) {
    throw new ExpectedError('Preset must be an array')
  }

  const map = new Map()
  const stack = preset.slice()

  for (const label of stack) {
    if (Array.isArray(label)) {
      stack.push(...label)
    } else if (!label.name || typeof label.name !== 'string') {
      throw new ExpectedError('Label name must be a string')
    } else {
      map.set(label.name, label)
    }
  }

  if (map.size === 0) {
    throw new ExpectedError('Preset must contain one or more label')
  }

  return Array.from(map.values())
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
