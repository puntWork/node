import Redis from 'ioredis'
import { Message } from '../types'

const redis = new Redis()

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

export default punt
