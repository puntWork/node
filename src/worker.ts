import main, { isTerminating, shutdown, startUp } from './lib/worker'
import path from 'path'
import { WorkerOpts } from './types'

const loadSource = async (sourcePath: string) => {
  const resolvedPath = path.resolve(sourcePath)
  const source = await import(resolvedPath)
  return source.default
}

export const run = async (sourcePath: string, opts: WorkerOpts = {}) => {
  await loadSource(sourcePath)
  await startUp()
  await main(opts)
}

// handler for SIGINT, received when the user presses C-c
process.on('SIGINT', () => {
  if (isTerminating()) return

  console.log('\nWorker received SIGINT, shutting down.')
  shutdown()
})

// handler for SIGTERM, received from kill command or process manager (e.g. systemd)
process.on('SIGTERM', () => {
  if (isTerminating()) return

  console.log('\nWorker received SIGINT, shutting down.')
  shutdown()
})
