'use strict'

const ProjectClone = require('../attend-project-clone').ProjectClone
const simpleOctokit = require('simple-octokit')
const uniq = require('uniq')
const path = require('path')
const fs = require('fs')
const root = process.cwd()

module.exports = function factory (options) {
  if (typeof options !== 'object' || options === null) {
    throw new TypeError('Options must be an object')
  }

  if (Array.isArray(options.org) || Array.isArray(options.user) || (options.org && options.user)) {
    const { org, user, cache, ...rest } = options
    const seen = new Set()
    const plugins = []

    for (const k of ['org', 'user']) {
      for (const login of [].concat(options[k] || [])) {
        if (!login || typeof login !== 'string') {
          throw new TypeError(`Nested ${k} must be a string`)
        } else if (seen.has(login)) {
          throw new Error(`Duplicate ${k}`)
        }

        const cacheKey = cache ? [cache, k, login].join('-').toLowerCase() : null

        seen.add(login)
        plugins.push(factory({ ...rest, cache: cacheKey, [k]: login }))
      }
    }

    return {
      async projects () {
        const all = []

        for (const plugin of plugins) {
          const projects = await plugin.projects()
          all.push(...projects)
        }

        return all
      }
    }
  }

  if ((!options.org && !options.user) || (options.org && options.user)) {
    throw new Error('Must provide either an org or user')
  } else if (typeof (options.org || options.user) !== 'string') {
    throw new TypeError('Org or user must be a string or array')
  } else if (!/^[a-z0-9-_.]+$/i.test(options.org || options.user)) {
    throw new Error('Org or user is invalid')
  }

  const token = options.token || process.env.GITHUB_TOKEN
  const login = options.org || options.user
  const object = options.org ? 'organization' : 'user'
  const ignore = (options.ignore || []).map(s => s.toLowerCase())
  const only = (options.only || []).map(s => s.toLowerCase())
  const filter = { isArchived: false, isEmpty: false, isFork: false, ...options.filter }
  const cacheKey = options.cache || null
  const limit = options.limit == null ? Infinity : options.limit

  if (cacheKey) {
    if (typeof cacheKey !== 'string') {
      throw new ExpectedError('The "cache" option must be a string')
    } else if (!/^[a-z\d\-_.]+$/.test(cacheKey)) {
      throw new ExpectedError('The "cache" option contains illegal characters')
    } else if (/^\.|\.{2,}|\.$/.test(cacheKey)) {
      throw new ExpectedError('The "cache" option contains illegal sequence')
    }
  }

  if (typeof limit !== 'number' || limit < 0) {
    throw new ExpectedError('The "limit" option must be a number >= 0 <= Infinity')
  }

  if (typeof token !== 'string' || token === '') {
    const hint = 'required scopes: public_repo or repo'
    throw new ExpectedError(`Please set options.token or GITHUB_TOKEN in the environment (${hint})`)
  }

  const octokit = simpleOctokit(token)
  const order = 'orderBy: { field: NAME, direction: ASC }'
  const q = ['first: 100', 'after: $cursor', order]
  const gitObjectQueries = []
  const gitObjectAliases = []

  if (filter.isPrivate != null) {
    q.push(`privacy: ${filter.isPrivate ? 'PRIVATE' : 'PUBLIC'}`)
  }

  if (filter.isFork != null) {
    q.push(`isFork: ${filter.isFork ? 'true' : 'false'}`)
  }

  if (object === 'user') {
    // Only include repositories that the current viewer owns
    q.push('affiliations: OWNER')
  }

  // Exclude by presence of files
  for (const filename of ([].concat(filter.hasFile || []))) {
    // TODO: use variables
    if (!/^[a-z\d.\-_]+$/i.test(filename)) {
      throw new ExpectedError(`Unsafe filename ${JSON.stringify(filename)}`)
    }

    const alias = `att_file${gitObjectQueries.length}`

    gitObjectQueries.push(`${alias}:object(expression: "HEAD:${filename}") { ... on Blob { id } }`)
    gitObjectAliases.push(alias)
  }

  return {
    async projects () {
      // TODO: cache by signature of options
      const cachePath = cacheKey ? path.join(root, '.attend', '.org-projects', cacheKey) : null
      const repositories = []

      if (cachePath && fs.existsSync(cachePath)) {
        const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'))
        repositories.push(...cached)
      } else {
        for (let i = 0, cursor = null; i < 10; i++) {
          const data = await octokit.graphql(
            `query ($login: String!, $cursor: String) {
              ${object}(login: $login) {
                repositories(${q.join(', ')}) {
                  pageInfo { endCursor, hasNextPage }
                  nodes {
                    name
                    nameWithOwner
                    isArchived
                    isEmpty
                    pushedAt
                    ${gitObjectQueries.join('\n')}
                  }
                }
              }
            }`,
            { login, cursor }
          )

          repositories.push(...data[object].repositories.nodes)
          cursor = data[object].repositories.pageInfo.endCursor

          if (!data[object].repositories.pageInfo.hasNextPage) {
            break
          }
        }

        if (cachePath) {
          fs.mkdirSync(path.dirname(cachePath), { recursive: true })
          fs.writeFileSync(cachePath, JSON.stringify(repositories, null, 2))
        }
      }

      const included = uniq(repositories.filter(include), cmpName)
      const sliced = limit < Infinity ? included.slice(0, limit) : included

      return sliced.map(map)

      function include (repository) {
        // Exclude repositories that were transferred to another owner
        if (repository.nameWithOwner !== `${login}/${repository.name}`) {
          return false
        }

        // Exclude by properties
        if (filter.isArchived != null && repository.isArchived !== filter.isArchived) {
          return false
        } else if (filter.isEmpty != null && repository.isEmpty !== filter.isEmpty) {
          return false
        } else if (filter.maxAge && Date.now() - new Date(repository.pushedAt) > filter.maxAge) {
          return false
        }

        const ln = repository.name.toLowerCase()
        const ls = repository.nameWithOwner.toLowerCase()

        // Exclude by name
        if (ignore.length && (ignore.includes(ln) || ignore.includes(ls))) {
          return false
        } else if (repository.name === '.github') {
          return false
        } else if (only.length && !(only.includes(ln) || only.includes(ls))) {
          return false
        }

        // Exclude by presence of files
        for (const alias of gitObjectAliases) {
          if (repository[alias] == null) return false
        }

        return true
      }

      function map (repository) {
        return new ProjectClone({
          ...options.clone,
          githost: `github:${login}/${repository.name}`
        })
      }
    }
  }
}

function cmpName (a, b) {
  return a.name.localeCompare(b.name)
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
