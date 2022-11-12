import { Redis } from 'ioredis'
import { Message, PuntConfig } from '../types'
import connect from '../redis'

let redis: Redis

const punt = async (job: string, data: unknown): Promise<string> => {
  const message: Message = {
    data,
    job,
    retryCount: 0,
    lastAttemptedAt: null,
    lastError: null,
  }

  const messageId = await redis.xadd(
    '__punt__:__default__',
    '*',
    'job',
    job,
    'message',
    JSON.stringify(message)
  )

  return messageId
}

/**
 * Initialize Punt with a Redis connection.
 *
 * Usage:
 *   import Punt from '@punt/node'
 *   const punt = Punt()
 *
 * @param puntConfig an optional config object to override the default Redis connection settings.
 * @returns the punt function used to enqueue jobs.
 */
const Punt = (puntConfig?: PuntConfig) => {
  redis = connect(puntConfig)

  return punt
}

export default Punt
