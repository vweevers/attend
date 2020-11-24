'use strict'

const attend = require('..')
const preset = require('github-label-preset')

const suite = attend()
  // Shallowly clone all repositories of github orgs
  .use(require('attend-org-projects'), {
    org: ['Level', 'airtap', 'prebuild'],
    user: ['vweevers'],
    filter: {
      isPrivate: false
    },
    clone: {
      depth: 1,
      sparse: true
    }
  })
  .use(require('attend-github-labels'), { preset })

async function main () {
  await suite.fix() // Or lint
}

main()
