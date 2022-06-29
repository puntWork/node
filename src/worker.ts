import main, { startUp } from './lib/worker'

const sourcePath = process.argv[2]

const loadSource = async () => {
  const source = await import(sourcePath)
  return source.default
}

loadSource()
  .then(() => startUp())
  .then(() => main())
