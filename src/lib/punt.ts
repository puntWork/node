import Redis from 'ioredis'

const redis = new Redis()

type workerHandler = (message: unknown) => void
export const worker = async (topic: string, handler: workerHandler) => {
  let message

  message = await redis.lpop(`queue:${topic}`)
  handler(JSON.parse(message))
}

const punt = async (topic: string, message: unknown): Promise<void> => {
  await redis.rpush(`queue:${topic}`, JSON.stringify(message))
}

export default punt
