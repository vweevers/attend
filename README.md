# attend (alpha)

**Automate maintenance tasks across many repositories.**

[![npm status](http://img.shields.io/npm/v/attend.svg)](https://www.npmjs.org/package/attend)
[![Markdown Style Guide](https://img.shields.io/badge/md_style-hallmark-brightgreen.svg)](https://www.npmjs.org/package/hallmark)
[![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)

![screenshot](screenshot.png)

## Highlights :sparkles:

- Loosely coupled plugins: their input is a directory, output is an array of affected files
- Run plugins on multiple repositories at once
- A plugin can export one or more (ideally idempotent) functions:
  - ~~`init()`: create something from scratch (à la yeoman and npm init)~~
  - `lint()`: find issues
  - `fix()`: fix issues
- Output is [vfile](https://github.com/vfile/vfile)-based, where every message has an associated source code position
  - For example, `attend-npm-dependencies` will show the line number of an outdated dependency in `package.json`

## Example

Upgrade `standard` in the working directory (which is the default target if you don't use a project plugin):

```js
// suite.js
module.exports = require('attend')
 .use(require('attend-npm-dependencies'), { only: ['standard'], bump: true })
 .use(require('attend-standard'))
 .use(require('attend-npm-test'))
```

This exports a "suite" of plugins that you can:

1. Run with `attend-cli`: `attend lint --use suite.js` or `attend fix --use suite.js` (TODO; for now do `node suite.js [lint | fix]`)
2. Run programmatically: `await suite.lint()` or `await suite.fix()`
3. Run in GitHub Actions workflows, adding `attend-reporter-github` (TODO) to report lint messages as status check annotations
4. Use as a preset in another suite: `.use(require('./suite.js'))`

Attend can also run on multiple projects in one go, either by cloning individual GitHub, GitLab or BitBucket repositories (with `attend-project-clone`), by cloning all GitHub repositories of given users and organizations (with `attend-org-projects`) or by scanning a local directory (with `attend-local-projects`).

For example, the following suite clones three repositories, upgrades `hallmark` in their `package.json`, fixes their markdown, runs tests and creates pull requests:

```js
module.exports = require('attend')
 .use(require('attend-project-clone'), 'github:vweevers/keyspace')
 .use(require('attend-project-clone'), 'github:Level/abstract-leveldown')
 .use(require('attend-project-clone'), 'github:Level/compose')
 .use(require('attend-git-branch'), 'attend/hallmark-3.1.0')
 .use(require('attend-npm-initial-install'))
 .use(require('attend-npm-dependencies'), { only: ['hallmark'], bump: true })
 .use(require('attend-hallmark'))
 .use(require('attend-npm-test'))
 .use(require('attend-git-commit'), 'Bump hallmark to 3.1.0')
 .use(require('attend-github-pr'), 'Bump hallmark to 3.1.0')
```

A suite can be run multiple times if needed, e.g. to make manual fixes or to locally review changes before opening pull requests. Plugins should account for this use case. For example, `attend-git-branch` does nothing if the given branch is already checked out; `attend-npm-dependencies` does nothing if `hallmark` was already upgraded in a previous run; `attend-github-pr` checks if a PR for the current branch already exists and if so it merely does a `git push` (unless there's nothing to push or the PR was merged or closed).

## Ideas

- features:
  - [ ] Export plugin manifests to determine if cloning can be shallow and sparse
  - [ ] `attend-repl-input` (take input for init steps)
  - [ ] Consider using [`git worktree`](https://git-scm.com/docs/git-worktree)
- helpers:
  - [x] `attend-git-branch`
  - [x] `attend-git-commit`
    - [x] `git add -A` for convenience
    - [x] Do nothing if nothing changed
    - [ ] Amend previous commit if message is the same (and ours)
  - [x] `attend-github-pr`
- projects:
  - [x] `attend-project-clone` (clone github repo by slug)
  - [x] `attend-org-projects` (clone all github repos from org or user)
  - [x] `attend-local-projects` (run on repositories in a directory)
- plugins:
  - js:
    - [x] `attend-npm-initial-install` (do npm install after cloning)
    - [x] `attend-npm-dependencies` (wrap `npm-check`)
    - [x] `attend-npm-test`
    - [ ] `attend-npm-package` (create new package, lint and fix it)
      - [x] `attend-npm-repository`
      - [ ] `attend-npm-package-license` (create license)
      - [ ] `attend-npm-package-readme` (create readme)
    - [ ] `attend-npm-package-sort` (sort deps etc)
    - [ ] `attend-npm-dependency` (add one or more dependencies)
    - [x] `attend-standard` (wrapper to convert report)
    - [ ] `attend-dependents` (canary testing)
    - [ ] `attend-npm-ignore`
    - [ ] `attend-npm-audit`
    - [ ] `attend-npm-unpublished` (warn if old changes are unpublished)
    - [ ] `attend-test-framework` (e.g. warn if mocha)
  - github:
    - [ ] `attend-github-unpushed`
      - if dirty: not ok
      - if `git fetch` fails: error
      - if `git diff --shortstat <branch> origin/<branch>` has output: not ok
    - [x] `attend-github-labels` (sync labels with a preset)
    - [x] `attend-github-repository` (create repo)
    - [ ] `attend-github-access`
    - [ ] `attend-github-branch-protection`
    - [ ] `attend-github-stale-issues`
  - git:
    - [ ] `attend-git` (just init)
    - [ ] `attend-git-ignore`
    - [ ] `attend-git-version-tags` (semver-validate tags starting with v)
    - [ ] `attend-git-stale-branches`
    - [ ] `attend-git-branch-mergeable`
    - [ ] `attend-git-main` (rename master to main)
    - [ ] `attend-git-rebase`
  - markdown:
    - [x] `attend-hallmark`
  - ci:
    - [x] `attend-dependabot` (create dependabot.yml, lint and fix)
    - [ ] `attend-migrate-travis-org-to-com`
    - [ ] `attend-migrate-travis-to-actions`

## Usage

## Presets

A set of plugins can be reused like so:

```js
const preset = attend()
 .use(require('attend-npm-dependencies'), { bump: true })
 .use(require('attend-npm-test'))

const suite = attend()
  .use(require('attend-project-clone'), 'vweevers/keyspace')
  .use(require('attend-project-clone'), 'Level/abstract-leveldown')
  .use(require('attend-project-clone'), 'Level/compose')
  .use(preset)
```

## Suitable for

- Trunk-based development (single git branch)
- Node.js, no other runtimes or languages for now
- Not monorepos
