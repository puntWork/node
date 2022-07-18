import { Command } from 'commander'
import { run } from './worker'

const program = new Command()

program
  .name('punt')
  .description(
    'punt-cli is a command line tool for managing background workers'
  )
  .version('1.0.2')

program
  .command('worker')
  .description('start a background worker')
  .argument('[entrypoint]', 'entrypoint file where all workers are loaded')
  .action(async (entrypoint) => {
    console.log('Worker started with PID:', process.pid)

    try {
      await run(entrypoint)
      process.exit(0)
    } catch (error) {
      console.error(error)
      process.exit(1)
    }
  })

program.parse()
