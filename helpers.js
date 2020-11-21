'use strict'

const vfile = require('vfile')
const gh = require('parse-github-url')
const Octokit = require('@octokit/core').Octokit
const promisify = require('util').promisify
const execFile = promisify(require('child_process').execFile)
const path = require('path')
const fs = require('fs')

const headBranchRe = /^\s*HEAD branch:/i
const homepage = require('./package.json').homepage

exports.branch = async function (project, name) {
  if (typeof name !== 'string') {
    throw new ExpectedError('Branch name must be a string')
  }

  if (!/^[a-z0-9/.\-_]+$/i.test(name)) {
    throw new ExpectedError(`Branch name "${name}" is invalid`)
  }

  const cwd = project.cwd
  const current = await currentBranch(cwd)

  if (current !== name) {
    const def = project.defaultBranch || (await defaultBranch(cwd)) || 'main'

    if (name === def) {
      await execFile('git', ['checkout', name], { cwd })
      await execFile('git', ['pull'], { cwd })
    } else {
      await execFile('git', ['fetch', '--tags'], { cwd })
      await execFile('git', ['checkout', '--no-track', '-b', name, 'origin/' + def], { cwd })
    }
  }
}

exports.commit = async function (project, message) {
  if (typeof message !== 'string' || message.trim() === '') {
    throw new ExpectedError('Commit message must be a string')
  }

  await execFile('git', ['add', '-A'], { cwd: project.cwd })

  const changed = await hasStagedChanges(project.cwd)
  if (!changed) return

  const branch = await currentBranch(project.cwd)
  if (!branch) throw new ExpectedError('Must be on a branch')

  await execFile('git', ['commit', '-m', message], { cwd: project.cwd })
}

exports.pr = async function (project, title) {
  if (typeof title !== 'string' || title.trim() === '') {
    throw new ExpectedError('Pull Request title must be a string')
  }

  // TODO: rc
  const token = process.env.GITHUB_TOKEN

  if (!token) {
    const hint = 'required scopes: public_repo'
    throw new ExpectedError(`Please set GITHUB_TOKEN in the environment (${hint})`)
  }

  const { cwd } = project
  const { owner, name } = ghrepo(cwd)

  // Base: the name of the branch you want the changes pulled into
  // Head: the name of the branch where your changes are implemented
  const octokit = new Octokit({ auth: token })
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
    const body = `This is an automated pull request created with [Attend](${homepage}).`
    const variables = { repositoryId: repository.id, base, head, title, body }

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

async function defaultBranch (cwd) {
  const args = ['remote', 'show', 'origin']
  const result = await execFile('git', args, { cwd })
  const lines = result.stdout.split(/\r?\n/)
  const line = lines.find(isHeadBranch)

  return line.split(/[: ]+/)[1].trim()
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

function isHeadBranch (line) {
  return headBranchRe.test(line)
}

async function hasStagedChanges (cwd) {
  const args = ['diff', '--staged', '--shortstat']
  const result = await execFile('git', args, { cwd })

  return result.stdout.trim() !== ''
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
