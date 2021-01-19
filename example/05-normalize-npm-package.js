'use strict'

const attend = require('..')

module.exports = attend()
  .use(require('attend-org-projects'), {
    user: 'vweevers',
    org: ['Level', 'airtap', 'prebuild'],
    cache: 'example-05',
    filter: {
      isPrivate: false,
      maxAge: 2 * 365 * 24 * 60 * 60 * 1e3,
      hasFile: 'package.json'
    },
    ignore: [
      // Exclude repositores by name or slug
      'vweevers/attend',
      'vweevers/about-native-modules',
      'vweevers/detect-tabular',
      'vweevers/map-tabular-keys',
      'vweevers/napi-functions',
      'vweevers/section-remark',
      'vweevers/student-histogram',
      'vweevers/spreadsheet-stream',
      'vweevers/tabular-stream',
      'vweevers/tmpgen',
      'vweevers/win-dummy-exe',
      'vweevers/win-find-jscript-compiler',
      'vweevers/windows-firefox',
      'Level/leveldown-mobile',
      'Level/level-fstream'
    ],
    clone: {
      depth: 1,
      sparse: true
    }
  })
  // TODO: write and add other npm-* plugins here
  .use(require('attend-npm-repository'))
