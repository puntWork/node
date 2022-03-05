import Redis from 'ioredis'
import { Message } from '../types'

const redisUrl = process.env.REDIS_URL || undefined

const redisOpts =
  process.env.NODE_ENV === 'production'
    ? {
        tls: {
          requestCert: true,
          rejectUnauthorized: false,
        },
      }
    : {}

const redis = new Redis(redisUrl, redisOpts)

type CallbackFn = (message: unknown) => void
interface HandlerMap {
  [key: string]: CallbackFn
}

const handlers: HandlerMap = {}

export const worker = (message: string, cb: CallbackFn): void => {
  console.log(`Registering callback for ${message}.`)
  handlers[message] = cb
}

interface WorkerOpts {
  timeout?: number
  verbose?: boolean
  topic?: string
  worker?: string
  group?: string
  ts?: number
  maxRetries?: number
}

const exponentialBackoff = (
  currentTimestamp: number,
  retryCount: number
): number => {
  const backoffMs = Math.pow(2, retryCount) * 1_000
  return currentTimestamp + backoffMs
}

const deadletter = async (message: Message): Promise<void> => {
  await redis.xadd(
    '__punt__:__deadletter__',
    '*',
    'job',
    message.job,
    'message',
    JSON.stringify(message)
  )
}

export const errorHandler = async (
  error: Error,
  opts: WorkerOpts,
  message: Message | null
) => {
  const ts = opts.ts ?? Date.now()
  const maxRetries = opts.maxRetries ?? 10

  if (message == null) return

  const updatedMessage = {
    ...message,
    retryCount: message.retryCount + 1,
    lastAttemptedAt: ts,
    lastError: error.message,
  }

  if (updatedMessage.retryCount >= maxRetries) {
    await deadletter(updatedMessage)
    return
  }

  const nextExecution = exponentialBackoff(ts, updatedMessage.retryCount)

  // Push message to retry set
  await redis.zadd(
    '__punt__:__retry_set__',
    nextExecution.toString(),
    JSON.stringify(updatedMessage)
  )
}

interface listenArgs {
  recovery: boolean
}

export const listenForMessages = async (
  args: listenArgs,
  opts: WorkerOpts = {}
): Promise<string | null> => {
  const timeout = opts.timeout ?? 0
  const verbose = process.env.VERBOSE ?? false
  const topic = opts.topic ?? '__default__'
  const group = opts.group ?? 'workers'
  const workerId = opts.worker ?? 'worker'

  let message: Message | null = null

  if (verbose) {
    console.log(`Listening for messages on the ${topic} topic.`)
  }

  let response

  if (args.recovery) {
    response = await redis.xreadgroup(
      'GROUP',
      group,
      workerId,
      'COUNT',
      1,
      'STREAMS',
      `__punt__:${topic}`,
      '0-0'
    )
  } else {
    response = await redis.xreadgroup(
      'GROUP',
      group,
      workerId,
      'COUNT',
      '1',
      'BLOCK',
      timeout,
      'STREAMS',
      `__punt__:${topic}`,
      '>'
    )
  }

  const [topicName, messages] = response[0]

  if (messages.length === 0) {
    // No message found, return null to signal there are no messages in the queue.
    // This is only used in recovery mode, when messages are read from the history
    // of pending messages.
    return null
  }

  const [messageId, [_jobAttrName, job, _messageAttrName, jsonEncodedMessage]] =
    messages[0]

  if (verbose) {
    console.log(
      `Processing message ID=${messageId} received on topic ${topicName}.`
    )
  }

  message = JSON.parse(jsonEncodedMessage)

  const handlerFn = handlers[job]

  if (handlerFn == null) {
    throw new Error(`No handler for job ${job}.`)
  }

  try {
    await Promise.resolve(handlerFn.call(null, message))

    await redis.xack(`__punt__:${topic}`, group, messageId)
  } catch (error) {
    if (error instanceof Error) {
      errorHandler(error, opts, message)
    } else {
      throw error
    }
  }

  // Returns the id of the successfully processed message
  return messageId
}

interface RetryMonitorArgs {
  ts?: number
}
export const retryMonitor = async (opts: RetryMonitorArgs = {}) => {
  const currentTime = opts.ts ?? Date.now()

  //pull first message from the RetrySet
  const [jsonEncodedMessage, time] = await redis.zpopmin(
    '__punt__:__retryset__'
  )

  // Handling empty sets
  if (jsonEncodedMessage == null) return

  const timeInt = parseInt(time)

  if (Number.isNaN(timeInt)) {
    throw new Error(
      `Fatal: ${time} not a valid timestamp, an integer was expected. The following message was likely lost: ${jsonEncodedMessage}.`
    )
  }

  if (timeInt <= currentTime) {
    // Adds message back to its queue for reprocessing
    const message = JSON.parse(jsonEncodedMessage)

    await redis.xadd(
      '__punt__:__default__',
      '*',
      'job',
      message.job,
      'message',
      jsonEncodedMessage
    )
  } else {
    // Adds message back to retry set
    await redis.zadd('__punt__:__retryset__', time, jsonEncodedMessage)
  }
}

export const startUp = async () => {
  try {
    await redis.xgroup(
      'CREATE',
      '__punt__:__default__',
      'workers',
      '$',
      'MKSTREAM'
    )
  } catch (error: any) {
    if (!error.message.includes('BUSYGROUP')) {
      // re-throw if error isn't a BUSYGROUP error, which is the redis error indicating the group
      // and stream already exist. If we do find a BUSYGROUP, we just ignore it.
      throw error
    }
  }

  // Reprocess messages from the group's history of pending messages
  let lastMessageId: string | null = '0-0'

  while (lastMessageId != null) {
    lastMessageId = await listenForMessages({ recovery: true })
  }
}

let isShuttingDown = false

const main = async (opts: WorkerOpts = {}) => {
  // Run the retryMonitor every 1 sec
  setInterval(retryMonitor, 1000)

  // Listen for messages in an infinite loop. This will be replaced with a condition
  // for graceful shutdown.
  while (!isShuttingDown) {
    await listenForMessages({ recovery: false }, opts)
  }

  redis.disconnect()
}

export const shutdown = () => {
  isShuttingDown = true
}

export default main
