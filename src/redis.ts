import Redis from 'ioredis'
import path from 'path'
import { PuntConfig } from './types'

let client: Redis.Redis

const connect = (config?: PuntConfig) => {
  if (client) {
    return client
  }

  if (config != null) {
    const { redisUrl, redisOptions } = config
    client = new Redis(redisUrl, redisOptions)

    return client
  }

  const projectRoot = process.cwd()
  let fileConfig: PuntConfig = {}

  try {
    fileConfig = require(path.join(projectRoot, 'punt.config.js'))
  } catch (error: any) {
    // Ignore MODULE_NOT_FOUND error as the config file is optional. Otherwise, rethrow.
    if (error?.code !== 'MODULE_NOT_FOUND') {
      throw error
    }
  }

  client = new Redis(fileConfig.redisUrl, fileConfig.redisOptions)

  return client
}

export default connect
