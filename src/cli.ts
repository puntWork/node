import { Command } from 'commander'
import { run } from './worker'

const program = new Command()

program
  .name('punt')
  .description(
    'punt-cli is a command line tool for managing background workers'
  )
  .version('1.2.6')

program
  .command('worker')
  .description('start a background worker')
  .argument('[entrypoint]', 'entrypoint file where all workers are loaded')
  .option('-t, --ts', 'use typescript')
  .option('-v, --verbose', 'turn on verbose logging')
  .action(async (entrypoint, options) => {
    console.log('Worker started with PID:', process.pid)

    if (options.ts || entrypoint.replace(/:.*$/, '').endsWith('.ts')) {
      const tsNode = await import('ts-node')
      tsNode.register({ transpileOnly: true })
    }

    try {
      await run(entrypoint, {
        verbose: options.verbose,
      })
      process.exit(0)
    } catch (error) {
      console.error(error)
      process.exit(1)
    }
  })

program.parse()
