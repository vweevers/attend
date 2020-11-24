'use strict'

const attend = require('..')

const suite = attend()
  // Shallowly clone all repositories of github orgs
  .use(require('attend-org-projects'), {
    org: ['Level', 'airtap'],
    filter: {
      isFork: false,
      isPrivate: false
    },
    ignore: [
      // Exclude repositores by name or slug
      'awesome',
      'Level/leveldown-mobile',
      'Level/leveldown-hyper',
      'Level/level-fstream',
      'Level/level-hyper',
      'Level/level-ttl'
    ],
    clone: {
      depth: 1,
      // Only checkout files in the root and these subdirectories
      sparse: ['.github', '.github/workflows']
    }
  })
  // Collect dependency information for attend-dependabot
  .use(require('attend-npm-dependencies'))
  // Create or update dependabot.yml
  .use(require('attend-dependabot'), {
    interval: 'monthly',
    npm: {
      // Ignore dependencies (if found in package.json)
      ignore: [
        'buffer',
        'dependency-check',
        'sinon',
        'engine.io',
        '@httptoolkit/osx-find-executable',
        'uuid'
      ]
    }
  })

async function main () {
  // await suite.lint()
  // return

  await suite.fix({
    branch: 'attend/dependabot-2020-11'
    // commit: 'Configure dependabot',
    // pr: 'Configure dependabot'
  })
}

main()
