'use strict'

const attend = require('..')

module.exports = attend()
  // Shallowly clone all repositories of github user
  .use(require('attend-org-projects'), {
    user: 'vweevers',
    filter: {
      isPrivate: false,
      // Exclude repositores by age (of last push)
      maxAge: 2 * 365 * 24 * 60 * 60 * 1e3
    },
    ignore: [
      // Exclude repositores by name or slug
      'attend',
      'about-native-modules',
      'detect-tabular',
      'map-tabular-keys',
      'napi-functions',
      'section-remark',
      'student-histogram',
      'spreadsheet-stream',
      'tabular-stream',
      'tmpgen',
      'win-dummy-exe',
      'win-find-jscript-compiler',
      'windows-firefox'
    ],
    clone: {
      depth: 1,
      // Only checkout files in the root and these subdirectories
      sparse: ['.github', '.github/workflows']
    }
  })
  .use(require('attend-git-branch'), 'attend/dependabot-2020-11')
  // Collect dependency information for attend-dependabot
  .use(require('attend-npm-dependencies'))
  // Create or update dependabot.yml
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
  // .use(require('attend-git-commit'), 'Configure dependabot')
  // .use(require('attend-github-pr'), 'Configure dependabot')
