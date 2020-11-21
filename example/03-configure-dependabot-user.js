'use strict'

const attend = require('..')

const opts = {
  filter: {
    isFork: false,
    isPrivate: false,
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
}

const suite = attend()
  // Clone all repositories of github user
  .use(require('attend-org-projects'), { user: 'vweevers', ...opts })
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
    // commit: 'Configure dependabot',
    // pr: 'Configure dependabot'
  })
}

main()