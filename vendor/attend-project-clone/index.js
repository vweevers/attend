'use strict'

const path = require('path')
const promisify = require('util').promisify
const execFile = promisify(require('child_process').execFile)
const gitPullOrClone = promisify(require('git-pull-or-clone'))

module.exports = function (slug) {
  return {
    async projects () {
      return [new ProjectClone(slug)]
    }
  }
}

class ProjectClone {
  constructor (slug) {
    if (typeof slug !== 'string' || !/^[a-z0-9-_]+\/[a-z0-9-_]+$/i.test(slug)) {
      throw new Error('Slug must be in the form of "owner/repo"')
    }

    this.cwd = path.resolve('.attend', slug.toLowerCase())
    this.url = `git@github.com:${slug}.git`
  }

  async open () {
    // TODO: check --single-branch logic
    await gitPullOrClone(this.url, this.cwd, { depth: Infinity })
    await execFile('git', ['fetch', '--tags'], { cwd: this.cwd })
  }
}
