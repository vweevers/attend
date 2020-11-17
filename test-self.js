'use strict'

const attend = require('.')

attend()
  .use(require('attend-npm-dependencies'), { bump: true })
  .use(require('attend-standard'))
  .use(require('attend-hallmark'))
  .use(require('attend-npm-test'))
  .lint()
