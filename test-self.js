'use strict'

const attend = require('.')

const suite = attend()
  .use(require('attend-npm-dependencies'), { bump: true })
  .use(require('attend-standard'))
  .use(require('attend-hallmark'))
  .use(require('attend-npm-test'))

async function main () {
  await suite.lint()
}

main()
