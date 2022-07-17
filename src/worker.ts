import main, { isTerminating, shutdown, startUp } from './lib/worker'
import path from 'path'

const sourcePath = process.argv[2]

const loadSource = async () => {
  const resolvedPath = path.resolve(sourcePath)
  const source = await import(resolvedPath)
  return source.default
}

console.log('Worker started with PID:', process.pid)

loadSource()
  .then(() => startUp())
  .then(() => main())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })

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
