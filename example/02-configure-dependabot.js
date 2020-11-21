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
    'Level/level-ttl'
  ],
  clone: {
    depth: 1,
    // Only checkout files in the root and these subdirectories
    sparse: ['.github', '.github/workflows']
  }
}

const suite = attend()
  // Clone all repositories from github orgs (or users)
  .use(require('attend-org-projects'), { org: 'Level', ...opts })
  .use(require('attend-org-projects'), { org: 'airtap', ...opts })
  .use(require('attend-dependabot'), {
    interval: 'monthly',
    npm: {
      // Ignore dependencies (if found in package.json)
      ignore: [
        'standard',
        'dependency-check',
        'tempy',
        'nyc',
        'sinon',
        'cross-env',
        'uuid'
      ]
    }
  })

async function main () {
  // await suite.lint()
  // return

  await suite.fix({
    branch: 'attend/dependabot-2020-11',
    // commit: 'Add or update dependabot',
    // pr: 'Add or update dependabot'
  })
}

main()
