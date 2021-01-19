'use strict'

const vfile = require('vfile')
const promisify = require('util').promisify
const simpleOctokit = require('simple-octokit')
const Githost = require('find-githost')
const execFile = promisify(require('child_process').execFile)

const kTitle = Symbol('title')
const kBody = Symbol('body')
const homepage = 'https://github.com/vweevers/attend'

module.exports = function plugin (options) {
  return new Plugin(options)
}

class Plugin {
  constructor (options) {
    if (typeof options === 'string') {
      options = { title: options }
    } else if (!options) {
      options = {}
    }

    const title = options.title
    const body = options.body || `This is an automated pull request created with [Attend](${homepage}).`

    if (typeof title !== 'string' || title.trim() === '') {
      throw new ExpectedError('Pull Request title must be a non-empty string')
    } else if (typeof body !== 'string' || body.trim() === '') {
      throw new ExpectedError('Pull Request body must be a non-empty string')
    }

    this[kTitle] = title
    this[kBody] = body
  }

  async fix (project) {
    // TODO: rc
    const token = process.env.GITHUB_TOKEN

    if (!token) {
      const hint = 'required scopes: public_repo'
      throw new ExpectedError(`Please set GITHUB_TOKEN in the environment (${hint})`)
    }

    const { cwd } = project
    const { type, owner, name } = Githost.fromGit(cwd)

    if (type !== 'github') {
      throw new ExpectedError(`Unsupported git host ${JSON.stringify(type)}`)
    }

    // Base: the name of the branch you want the changes pulled into
    // Head: the name of the branch where your changes are implemented
    const octokit = simpleOctokit(token)
    const base = await defaultBranchQuery(octokit, owner, name)
    const head = await currentBranch(cwd)

    if (!head) {
      throw new ExpectedError('Must be on a branch')
    } else if (head === base) {
      throw new ExpectedError('Cannot create pull request from default branch')
    }

    if (!(await areBranchesDifferent(cwd, base, head))) {
      return
    }

    // Get repository id and existing pull request if any
    const { repository } = await octokit.graphql(
      `query ($owner: String!, $name: String!, $base: String!, $head: String!) {
        repository(name: $name, owner: $owner) {
          id
          pullRequests(baseRefName: $base, headRefName: $head, last: 2) {
            nodes { state, url }
          }
        }
      }`,
      { owner, name, base, head }
    )

    const file = vfile({ path: '.', cwd })
    const result = { files: [file] }
    const pullRequests = repository.pullRequests.nodes
    const pr = pullRequests[0]

    if (pullRequests.length > 1) {
      throw new ExpectedError(`There are multiple existing pull requests for ${head}`)
    }

    // Don't push if already merged
    if (pr && (pr.state === 'MERGED' || pr.state === 'CLOSED')) {
      file.info(`Pull request was already ${pr.state.toLowerCase()}: ${pr.url}`, null, 'attend:pr')
      return result
    }

    await execFile('git', ['push', '--set-upstream', 'origin', head], { cwd })

    if (!pr) {
      const variables = {
        repositoryId: repository.id,
        base,
        head,
        title: this[kTitle],
        body: this[kBody]
      }

      const { createPullRequest } = await octokit.graphql(
        `mutation ($repositoryId: String!, $base: String!, $head: String!, $title: String!, $body: String!) {
          createPullRequest(input: {
            repositoryId: $repositoryId,
            baseRefName: $base,
            headRefName: $head,
            title: $title,
            body: $body
          }) {
            pullRequest { url }
          }
        }`,
        variables
      )

      file.info(`Created ${createPullRequest.pullRequest.url}`, null, 'attend:pr')
    }

    return result
  }
}

async function defaultBranchQuery (octokit, owner, name) {
  const data = await octokit.graphql(
    `query ($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        defaultBranchRef {
          name
        }
      }
    }`,
    { owner, name }
  )

  return data.repository.defaultBranchRef.name
}

async function areBranchesDifferent (cwd, base, head) {
  const args = ['diff', '--shortstat', base, head, '--']
  const result = await execFile('git', args, { cwd })

  return result.stdout.trim() !== ''
}

async function currentBranch (cwd) {
  const args = ['branch', '--show-current']
  const result = await execFile('git', args, { cwd })

  return result.stdout.trim()
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
