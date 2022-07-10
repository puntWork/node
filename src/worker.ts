import main, { startUp } from './lib/worker'
import path from 'path'

const sourcePath = process.argv[2]

const loadSource = async () => {
  const resolvedPath = path.resolve(sourcePath)
  const source = await import(resolvedPath)
  return source.default
}

loadSource()
  .then(() => startUp())
  .then(() => main())
