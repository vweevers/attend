'use strict'

const attend = require('..')

const opts = {
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
    'Level/level-ttl',
    'Level/rocksdb'
  ],
  clone: {
    depth: 1,
    // Only checkout files in the root and these subdirectories
    sparse: ['.github', '.github/workflows']
  }
}

const suite = attend()
  // Clone all repositories of github orgs
  .use(require('attend-org-projects'), { org: 'Level', ...opts })
  .use(require('attend-org-projects'), { org: 'airtap', ...opts })
  .use(require('attend-npm-dependencies'))
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
