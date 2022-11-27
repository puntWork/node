import Redis, { RedisOptions } from 'ioredis'
import { PuntConfig } from './types'
import Debug from 'debug'
import { loadConfiguration } from './lib/loadConfiguration'

const debug = Debug('punt:redis')

let client: Redis.Redis

/**
 * Connect to Redis and returns a Redis client. Optionally takes a config object. If no config object
 * is provided, it falls back to:
 *
 *   1. Environment variables (REDIS_URL, REDIS_TLS_REJECT_UNAUTHORIZED)
 *   2. The `punt.config.js` configuration file (redisUrl, redisOptions)
 *   3. Default values (redis://localhost:6379)
 *
 * @param config optional config object
 * @returns a Redis client
 */
const connect = (config?: PuntConfig) => {
  if (client) {
    return client
  }

  if (config != null) {
    client = new Redis(config.redisUrl, config.redisOptions)
    debug('Connected to Redis at %s', config.redisUrl)

    return client
  }

  const url = redisUrl()
  const options = redisOptions(url)

  client = new Redis(url, options)
  debug('Connected to Redis at %s', url)

  return client
}

/**
 * Gets Redis connection options from the config file or environment variables.
 *
 * This function gives precedence to the environment variable `REDIS_TLS_REJECT_UNAUTHORIZED`
 * over the `redisOptions.tls.rejectUnauthorized` option in the config file.
 *
 * This function intentionally strips out the TLS options from the config file if the connection
 * is not encrypted. This allows for the use of a single configuration file for both encrypted (production) and
 * unencrypted (development) connections. If the `tls` options are set, ioredis will fail to connect
 * over an unencrypted connection.
 *
 * @param redisUrl A Redis connection string
 * @returns Options for Redis connection
 */
export const redisOptions = (redisUrl: string): RedisOptions => {
  const { redisOptions } = loadConfiguration()

  if (process.env.REDIS_TLS_REJECT_UNAUTHORIZED === '0') {
    return {
      ...redisOptions,
      tls: {
        ...redisOptions?.tls,
        rejectUnauthorized: false,
      },
    }
  }

  const url = redisUrl != null ? new URL(redisUrl) : null
  if (!url || url.protocol === 'redis:') {
    return {}
  }

  return redisOptions || {}
}

/**
 * Returns the Redis connection string and options from the config file or environment variables.
 *
 * This function gives precedence to the environment variable `REDIS_URL` over the `redisUrl` option
 * in the config file.
 *
 * If no connection string is provided, the default connection string is used.
 *
 * @returns a Redis connection string or undefined if none is found
 */
export const redisUrl = (): string => {
  if (process.env.REDIS_URL) {
    return process.env.REDIS_URL
  }

  const config = loadConfiguration()

  return config.redisUrl || 'redis://localhost:6379'
}

export default connect
