import { Message, WorkerOpts } from '../types'
import Debug from 'debug'
import connect from '../redis'

const redis = connect()
let debug = Debug('punt:worker')
const logger = console

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

  debug(
    `Registering callback for ${message} with options ${JSON.stringify(opts)}.`
  )

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
  messageId: string,
  message: Message,
  error: Error,
  settings: ErrorHandlerSettings
) => {
  const { maxRetries, ts = Date.now() } = settings

  if (message == null) return

  logger.error(
    `Processing ${message.job} job id=${messageId} failed with error:`,
    error.message
  )

  const updatedMessage = {
    ...message,
    retryCount: message.retryCount + 1,
    lastAttemptedAt: ts,
    lastError: error.message,
  }

  if (updatedMessage.retryCount >= maxRetries) {
    debug(
      `The ${message.job} job id=${messageId} has exceeded the maximum number of retries of ${maxRetries}.`
    )

    await deadletter(updatedMessage)
    return
  }

  const nextExecution = exponentialBackoff(ts, updatedMessage.retryCount)

  debug(
    `The ${
      message.job
    } job id=${messageId} will be scheduled for retry on ${new Date(
      nextExecution
    ).toISOString()} (retry ${updatedMessage.retryCount} out of ${maxRetries})`
  )

  // Push message to retry set
  await redis.zadd(
    '__punt__:__retryset__',
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

  message = JSON.parse(jsonEncodedMessage)

  if (message == null) {
    throw new Error('Last message received is unexpectedly empty. Aborting.')
  }

  debug(
    `Processing ${message.job} job with id=${messageId} received on topic ${topicName}: ${jsonEncodedMessage}`
  )

  const handler = handlers[job]

  if (handler == null) {
    throw new Error(`No handler for job ${job}.`)
  }

  try {
    await Promise.resolve(handler.cb.call(null, message.data))
    debug(
      `The ${message.job} job with id=${messageId} received on topic ${topicName} was successfully processed.`
    )
  } catch (error) {
    if (error instanceof Error) {
      errorHandler(messageId, message, error, {
        maxRetries: handler.maxRetries,
        ts,
      })
    } else {
      throw error
    }
  }

  debug(
    `Ack-ing ${message.job} job with ID=${messageId} received on topic ${topicName}.`
  )
  await redis.xack(`__punt__:${topic}`, group, messageId)

  // Returns the id of the successfully processed message
  return messageId
}

interface RetryMonitorArgs {
  ts?: number
}

export const retryMonitor = async (opts: RetryMonitorArgs = {}) => {
  const currentTime = opts.ts ?? Date.now()

  // Duplicate the redis connection as the main connection is likely blocked by listenToMessages.
  const retryConnection = redis.duplicate()

  // Watch the retry set for changes
  await retryConnection.watch('__punt__:__retryset__')

  debug(`[Retry Monitor] Checking for messages to retry at ${currentTime}.`)

  // Check if any messages with a score lower than the current time exist in the retry set
  const [jsonEncodedMessage] = await retryConnection.zrangebyscore(
    '__punt__:__retryset__',
    '-inf',
    currentTime,
    'LIMIT',
    0,
    1
  )

  // If no messages are found, return
  if (jsonEncodedMessage == null) {
    debug(`[Retry Monitor] No messages found for retrying.`)
    await retryConnection.unwatch()
  } else {
    const message = JSON.parse(jsonEncodedMessage)

    debug(`[Retry Monitor] Retrying job ${jsonEncodedMessage}`)

    // Adds message back to its queue for reprocessing and removes it from
    // the retry set
    await retryConnection
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

  retryConnection.disconnect()
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
  const interval = setInterval(() => retryMonitor(), 1000)

  while (!isShuttingDown) {
    await listenForMessages({ recovery: false }, opts)
  }

  clearInterval(interval)

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
