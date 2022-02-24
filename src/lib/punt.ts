import Redis from 'ioredis'

const redis = new Redis()

type workerHandler = (message: unknown) => void
export const worker = async (topic: string, handler: workerHandler) => {
  let message

  message = await redis.lpop(`queue:${topic}`)
  handler(JSON.parse(message))
}

const punt = async (job: string, message: unknown): Promise<string> => {
  let messageId = await redis.xadd(
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
