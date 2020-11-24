'use strict'

const vfile = require('vfile')
const githubLabelSync = require('github-label-sync')
const gh = require('parse-github-url')
const path = require('path')
const fs = require('fs')
const ignore = Symbol('ignore')

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

    try {
      const diff = await githubLabelSync({
        repo: project.slug || ghslug(cwd),
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
      if (err.endpoint) {
        err = new ExpectedError(`GitHub error:\n${error.method} ${error.endpoint}\n${error.statusCode}: ${error.message}`)
      }

      file.message(err, null, 'attend-github-labels:sync').fatal = true
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
    throw new ExpectedError(`Preset must be an array`)
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

function ghslug (cwd) {
  const { owner, name } = ghrepo(cwd)
  return `${owner}/${name}`
}

function ghrepo (cwd) {
  const fp = path.join(cwd, 'package.json')
  const pkg = JSON.parse(fs.readFileSync(fp, 'utf8'))
  const repository = pkg.repository || {}
  const parsed = gh(repository.url || repository)

  if (!parsed) {
    throw new ExpectedError('Unable to determine GitHub owner and name')
  }

  return parsed
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
