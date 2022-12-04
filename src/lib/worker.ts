import { Message, WorkerOpts } from '../types'
import Debug from 'debug'
import connect from '../redis'

const redis = connect()
let debug = Debug('punt:worker')

//eslint-disable-next-line @typescript-eslint/no-explicit-any
type CallbackFn = (message: any) => void
interface HandlerMap {
  [key: string]: {
    cb: CallbackFn
    maxRetries: number
  }
}
interface handlersOpts {
  maxRetries?: number
  retry?: boolean
}

const handlers: HandlerMap = {}
export const worker = (
  message: string,
  cb: CallbackFn,
  opts: handlersOpts = {}
): void => {
  const retry = opts.retry ?? true
  const maxRetries = retry ? opts.maxRetries ?? 20 : 0

  debug(`Registering callback for ${message} with options ${opts}.`)

  handlers[message] = {
    cb,
    maxRetries,
  }
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

interface ErrorHandlerSettings {
  maxRetries: number
  ts?: number
}

export const errorHandler = async (
  message: Message,
  error: Error,
  settings: ErrorHandlerSettings
) => {
  const { maxRetries, ts = Date.now() } = settings

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
  const timeout = opts.timeout ?? 5_000
  const topic = opts.topic ?? '__default__'
  const group = opts.group ?? 'workers'
  const workerId = opts.worker ?? 'worker'
  const ts = opts.ts ?? Date.now()

  let message: Message | null = null

  debug(`Listening for messages on the ${topic} topic.`)

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

  if (response == null) {
    return null
  }

  const [topicName, messages] = response[0]

  if (messages.length === 0) {
    // No message found, return null to signal there are no messages in the queue.
    return null
  }

  const [messageId, [_jobAttrName, job, _messageAttrName, jsonEncodedMessage]] =
    messages[0]

  debug(`Processing message ID=${messageId} received on topic ${topicName}.`)

  message = JSON.parse(jsonEncodedMessage)

  if (message == null) {
    throw new Error('Last message received is unexpectedly empty. Aborting.')
  }

  const handler = handlers[job]

  if (handler == null) {
    throw new Error(`No handler for job ${job}.`)
  }

  try {
    await Promise.resolve(handler.cb.call(null, message))

    await redis.xack(`__punt__:${topic}`, group, messageId)
  } catch (error) {
    if (error instanceof Error) {
      errorHandler(message, error, { maxRetries: handler.maxRetries, ts })
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

  // Watch the retry set for changes
  await redis.watch('__punt__:__retryset__')

  // Check if any messages with a score lower than the current time exist in the retry set
  const [jsonEncodedMessage] = await redis.zrangebyscore(
    '__punt__:__retryset__',
    '-inf',
    currentTime,
    'LIMIT',
    0,
    1
  )

  // If no messages are found, return
  if (jsonEncodedMessage == null) {
    await redis.unwatch()
    return
  }

  const message = JSON.parse(jsonEncodedMessage)

  // Adds message back to its queue for reprocessing and removes it from
  // the retry set
  await redis
    .multi()
    .xadd(
      '__punt__:__default__',
      '*',
      'job',
      message.job,
      'message',
      jsonEncodedMessage
    )
    .zrem('__punt__:__retryset__', jsonEncodedMessage)
    .exec()
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
  } catch (error) {
    if (error instanceof Error) {
      if (!error.message.includes('BUSYGROUP')) {
        // re-throw if error isn't a BUSYGROUP error, which is the redis error indicating the group
        // and stream already exist. If we do find a BUSYGROUP, we just ignore it.
        throw error
      }
    } else {
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
  // If we receive a name for this worker, replace the debugger instance to use it.
  if (opts.worker != null) {
    debug = Debug(`punt:${opts.worker}`)
  }

  // Set verbose mode if the -v flag is passed
  if (opts.verbose) {
    Debug.enable('punt:*')
  }

  // Run the retryMonitor every 1 sec
  setInterval(retryMonitor, 1000)

  while (!isShuttingDown) {
    await listenForMessages({ recovery: false }, opts)
  }

  redis.disconnect()

  // eslint-disable-next-line no-console
  console.log('Shutdown complete.')
}

export const shutdown = () => {
  // eslint-disable-next-line no-console
  console.log('Waiting for current job to finish...')
  isShuttingDown = true
}

export const isTerminating = () => isShuttingDown

export default main
