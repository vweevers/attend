'use strict'

const Octokit = require('@octokit/core').Octokit
const throttling = require('@octokit/plugin-throttling').throttling
const vfile = require('vfile')
const path = require('path')
const fsp = require('fs').promises

module.exports = function (options) {
  return new Plugin(options || {})
}

class Plugin {
  constructor (options) {
    const token = options.token || process.env.GITHUB_TOKEN

    if (!token) {
      const hint = 'required scopes: admin:org and public_repo or repo'
      throw new ExpectedError(`Please set options.token or GITHUB_TOKEN in the environment (${hint})`)
    }

    this._octokit = octo({ auth: token })
    this._topicNames = options.topicNames || []
  }

  async lint (project) {
    return this._run(project, false)
  }

  async fix (project) {
    return this._run(project, true)
  }

  async _run (project, fix) {
    const cwd = project.cwd
    const githost = project.githost
    const file = vfile({ path: '.', cwd })
    const pkgPath = path.join(cwd, 'package.json')
    const pkg = JSON.parse(await fsp.readFile(pkgPath, 'utf8'))

    if (githost.type !== 'github') {
      const rule = 'attend-github-repository:git-host'
      file.info(`Skipping git host \`${githost.type}\``, null, rule)
      return { files: [file] }
    }

    const owner = project.githost.owner
    const name = project.githost.name

    // TODO: take from input?
    let description = pkg.description

    if (typeof description !== 'string' || description.trim() === '') {
      const rule = 'attend-github-repository:description'
      file.message('Cannot find description', null, rule).fatal = true
      return { files: [file] }
    }

    if (!description.endsWith('.')) {
      description = description + '.'
    }

    // TODO: support user too
    const data = await this._octokit.graphql(
      `query ($login: String!, $name: String!) {
        organization(login: $login) {
          id
          repository(name: $name) {
            id
          }
        }
      }`,
      { login: owner, name }
    )

    if (!data.organization) {
      const rule = 'attend-github-repository:org'
      file.message(`Org \`${owner}\` not found`, null, rule).fatal = true
      return { files: [file] }
    }

    const ownerId = data.organization.id

    if (!data.organization.repository) {
      if (fix) {
        await this._createRepository(file, ownerId, name, description)
      } else {
        const rule = 'attend-github-repository:repo'
        file.message(`Create repository \`${owner}/${name}\``, null, rule).fatal = true
      }
    }

    return { files: [file] }
  }

  async _createRepository (file, ownerId, name, description) {
    const { createRepository } = await this._octokit.graphql(
      `mutation ($ownerId: String!, $name: String!, $description: String!) {
        createRepository(input: {
          ownerId: $ownerId,
          name: $name,
          description: $description,
          visibility: PUBLIC,
          hasWikiEnabled: false }) {
          repository { url, id }
        }
      }`,
      { ownerId, name, description }
    )

    const repositoryId = createRepository.repository.id
    const url = createRepository.repository.url

    file.info(`Created repository ${url}`, null, 'attend-github-repository:repo')

    // TODO: move to separate plugin (that can lint this as well)
    const { createBranchProtectionRule } = await this._octokit.graphql(
      `mutation ($repositoryId: String!, $pattern: String!) {
        createBranchProtectionRule(input: {
          repositoryId: $repositoryId,
          pattern: $pattern,
          isAdminEnforced: true,
          requiresLinearHistory: true,
          allowsForcePushes: false,
          allowsDeletions: false
        }) {
          branchProtectionRule { id }
        }
      }`,
      { repositoryId, pattern: 'main' }
    )

    const ruleId = createBranchProtectionRule.branchProtectionRule.id
    file.info(`Created branch protection rule \`${ruleId}\``, null, 'attend-github-repository:branch-protection')

    if (this._topicNames.length > 0) {
      // TODO: move to separate plugin (that can lint this as well)
      await this._octokit.graphql(
        `mutation ($repositoryId: String!, $topicNames: [String!]!) {
          updateTopics(input: { repositoryId: $repositoryId, topicNames: $topicNames }) {
            invalidTopicNames
          }
        }`,
        { repositoryId, topicNames: this._topicNames }
      )

      // TODO: deal with invalidTopicNames (is that an array?)
      file.info('Added topics', null, 'attend-github-repository:topic')
    }
  }
}

function octo (options) {
  const Ctor = Octokit.plugin(throttling)

  return new Ctor({
    ...options,
    throttle: {
      onRateLimit: function (retryAfter, options) {
        return options.request.retryCount < 5
      },
      onAbuseLimit: function (retryAfter, options) {
        // Nothing to be done
      }
    }
  })
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
