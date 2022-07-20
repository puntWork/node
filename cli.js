const { Command } = require('commander')
const { version } = require('./package.json')
const { run } = require('./dist/worker')

const program = new Command()

program
  .name('punt')
  .description(
    'punt-cli is a command line tool for managing background workers'
  )
  .version(version)

program
  .command('worker')
  .description('start a background worker')
  .argument('[entrypoint]', 'entrypoint file where all workers are loaded')
  .option('-t, --ts', 'use typescript')
  .action(async (entrypoint, options) => {
    console.log('Worker started with PID:', process.pid)

    if (options.ts || entrypoint.endsWith('.ts')) {
      require('ts-node').register()
    }

    try {
      await run(entrypoint)
      process.exit(0)
    } catch (error) {
      console.error(error)
      process.exit(1)
    }
  })

program.parse()
