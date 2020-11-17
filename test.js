'use strict'

const attend = require('.')

const suite = attend()
  .use(require('attend-project-clone'), 'vweevers/keyspace')
  .use(require('attend-project-clone'), 'Level/levelup')
  .use(require('attend-project-clone'), 'Level/abstract-leveldown')
  .use(require('attend-project-clone'), 'Level/bench')
  .use(require('attend-project-clone'), 'Level/codec')
  .use(require('attend-project-clone'), 'Level/compose')
  .use(require('attend-npm-dependencies'), { only: ['hallmark'], bump: true })
  .use(require('attend-hallmark'))
  .use(require('attend-npm-test'))

async function main () {
  // TODO: can't lint without deps, but init does too much
  // await suite.init()
  // await suite.lint()

  await suite.fix({
    branch: 'attend/hallmark-3.1.0',
    commit: 'Fix markdown', // TODO
    pr: 'Fix markdown' // TODO
  })
}

main()
