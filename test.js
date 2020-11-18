'use strict'

const attend = require('.')

const suite = attend()
  .use(require('attend-project-clone'), 'Level/abstract-leveldown')
  .use(require('attend-project-clone'), 'Level/bench')
  .use(require('attend-project-clone'), 'Level/codec')
  .use(require('attend-project-clone'), 'Level/concat-iterator')
  .use(require('attend-project-clone'), 'Level/compose')
  .use(require('attend-project-clone'), 'Level/deferred-leveldown')
  .use(require('attend-project-clone'), 'Level/encoding-down')
  .use(require('attend-project-clone'), 'Level/errors')
  .use(require('attend-project-clone'), 'Level/iterator-stream')
  .use(require('attend-project-clone'), 'Level/levelup')
  .use(require('attend-project-clone'), 'Level/level-rocksdb')
  .use(require('attend-project-clone'), 'Level/level-test')
  .use(require('attend-project-clone'), 'Level/mem')
  .use(require('attend-project-clone'), 'Level/memdown')
  .use(require('attend-project-clone'), 'Level/multileveldown')
  .use(require('attend-project-clone'), 'Level/packager')
  .use(require('attend-project-clone'), 'Level/party')
  .use(require('attend-project-clone'), 'Level/subleveldown')
  .use(require('attend-project-clone'), 'Level/supports')
  .use(require('attend-project-clone'), 'vweevers/detect-tabular')
  .use(require('attend-project-clone'), 'vweevers/keyspace')
  .use(require('attend-project-clone'), 'vweevers/node-docker-machine')
  .use(require('attend-project-clone'), 'vweevers/win-detect-browsers')
  .use(require('attend-project-clone'), 'vweevers/zipfian-integer')
  .use(require('attend-npm-initial-install'))
  .use(require('attend-npm-dependencies'), { only: ['hallmark'], bump: true })
  .use(require('attend-hallmark'))
  .use(require('attend-npm-test'))

async function main () {
  // await suite.lint()

  await suite.fix({
    branch: 'attend/hallmark-3.1.0',
    commit: 'Bump hallmark to 3.1.0',
    pr: 'Bump hallmark to 3.1.0' // TODO
  })
}

main()
