import {
  listenForMessages,
  retryMonitor,
  shutdown,
  startUp,
  isTerminating,
  worker,
} from './worker'

import Redis from 'ioredis'

const redis = new Redis()
const myfn = jest.fn()

afterEach(async () => {
  await redis.flushdb()
})

describe('startUp', () => {
  it('ensures the stream and group exists', async () => {
    await startUp()

    const [[_attrName, groupName]] = await redis.xinfo(
      'GROUPS',
      '__punt__:__default__'
    )

    expect(groupName).toBe('workers')
  })

  it(`doesn't fail if the group already exists`, async () => {
    await redis.xgroup(
      'CREATE',
      '__punt__:__default__',
      'workers',
      '$',
      'MKSTREAM'
    )

    await startUp()

    const [[_attrName, groupName]] = await redis.xinfo(
      'GROUPS',
      '__punt__:__default__'
    )

    expect(groupName).toBe('workers')
  })

  describe('handling crash recovery', () => {
    worker('recoverjob', myfn)

    beforeEach(async () => {
      await redis.xgroup(
        'CREATE',
        '__punt__:__default__',
        'workers',
        '$',
        'MKSTREAM'
      )

      await redis.xadd(
        '__punt__:__default__',
        '*',
        'job',
        'recoverjob',
        'message',
        JSON.stringify({ data: { id: 1 } })
      )
    })

    it('re-process pending (received but not acked) messages', async () => {
      // pulls the message
      await redis.xreadgroup(
        'GROUP',
        'workers',
        'worker',
        'COUNT',
        1,
        'STREAMS',
        `__punt__:__default__`,
        '>'
      )

      await listenForMessages({ recovery: true })

      expect(myfn).toBeCalledWith({ id: 1 })
    })
  })
})

describe('listenForMessages', () => {
  const message = { data: { id: 'message-2' } }

  worker('myjob', myfn)

  beforeEach(async () => {
    await redis.xgroup(
      'CREATE',
      '__punt__:__default__',
      'workers',
      '$',
      'MKSTREAM'
    )

    await redis.xadd(
      '__punt__:__default__',
      '*',
      'job',
      'myjob',
      'message',
      JSON.stringify(message)
    )
  })

  test('calling workers', async () => {
    await listenForMessages({ recovery: false }, { worker: 'worker.1' })

    expect(myfn).toBeCalledWith(message.data)
  })

  test('XACKing messages after successful processing', async () => {
    await listenForMessages({ recovery: false }, { worker: 'worker.1' })

    const [pendingMessages] = await redis.xpending(
      '__punt__:__default__',
      'workers'
    )

    expect(pendingMessages).toBe(0)
  })
})

describe('handling errors', () => {
  const message = {
    data: { id: 'willFail' },
    retryCount: 2,
    job: 'errorjob',
    lastAttemptedAt: Date.now() - 8_000,
    lastError: 'An error occurred',
  }

  const errorFn = jest.fn(() => {
    throw new Error('job failed')
  })

  worker('errorjob', errorFn, { maxRetries: 5 })

  beforeEach(async () => {
    await redis.xgroup(
      'CREATE',
      '__punt__:__default__',
      'workers',
      '$',
      'MKSTREAM'
    )

    await redis.xadd(
      '__punt__:__default__',
      '*',
      'job',
      'errorjob',
      'message',
      JSON.stringify(message)
    )
  })

  test('errored jobs get send to the retry set', async () => {
    await listenForMessages({ recovery: false })

    const result = await redis.zrange(
      '__punt__:__retryset__',
      0,
      -1,
      'WITHSCORES'
    )

    expect(result.length).toBeGreaterThan(0)
    const parsedMessage = JSON.parse(result[0])
    expect(parsedMessage.data).toEqual({ id: 'willFail' })
  })

  test('errored jobs are acked', async () => {
    await listenForMessages({ recovery: false })

    // If the message was successfully acknowledged by the worker, we won't be able to read it again
    // below with the xreadgroup call
    const result = await redis.xpending('__punt__:__default__', 'workers')

    expect(result[0]).toEqual(0)
  })

  test('sets the next execution time as the sorted set score', async () => {
    const currentTimestamp = Date.now()
    const nextExecutionTime = currentTimestamp + 8_000 // increases by 8 seconds

    await listenForMessages({ recovery: false }, { ts: currentTimestamp })

    const [_jsonEncodedMessage, score] = await redis.zrange(
      '__punt__:__retryset__',
      0,
      -1,
      'WITHSCORES'
    )

    expect(parseInt(score)).toEqual(nextExecutionTime)
  })

  test('increments the message retry count', async () => {
    await listenForMessages({ recovery: false })

    const [jsonEncodedMessage] = await redis.zrange(
      '__punt__:__retryset__',
      0,
      -1,
      'WITHSCORES'
    )

    const message = JSON.parse(jsonEncodedMessage)

    expect(message.retryCount).toEqual(3)
  })

  test('sets last execution time', async () => {
    const currentTimestamp = Date.now()
    await listenForMessages({ recovery: false }, { ts: currentTimestamp })

    const [jsonEncodedMessage] = await redis.zrange(
      '__punt__:__retryset__',
      0,
      -1,
      'WITHSCORES'
    )

    const message = JSON.parse(jsonEncodedMessage)

    expect(message.lastAttemptedAt).toEqual(currentTimestamp)
  })

  test('sets last error', async () => {
    await listenForMessages({ recovery: false })

    const [jsonEncodedMessage] = await redis.zrange(
      '__punt__:__retryset__',
      0,
      -1,
      'WITHSCORES'
    )

    const message = JSON.parse(jsonEncodedMessage)

    expect(message.lastError).toEqual('job failed')
  })

  test('moves the message to the deadletter stream after retries are exhausted', async () => {
    worker('deadletterTest', errorFn, { maxRetries: 2 })

    const noRetryMessage = {
      ...message,
      job: 'deadletterTest',
      data: { id: 'deadletterTest' },
    }

    await redis.xadd(
      '__punt__:__default__',
      '*',
      'job',
      'deadletterTest',
      'message',
      JSON.stringify(noRetryMessage)
    )

    await listenForMessages({ recovery: false })
    await listenForMessages({ recovery: false })

    const [deadLetters] = await redis.xread(
      'COUNT',
      1,
      'STREAMS',
      '__punt__:__deadletter__',
      '0-0'
    )

    const [
      _topicName,
      [
        [
          _messageId,
          [_jobAttrName, _job, _messageAttrName, jsonEncodedMessage],
        ],
      ],
    ] = deadLetters

    const decodedMessage = JSON.parse(jsonEncodedMessage)

    expect(decodedMessage.data).toEqual({ id: 'deadletterTest' })
  })

  test('allow setting the max retries', async () => {
    worker('noRetry', errorFn, { maxRetries: 3 })

    const noRetryMessage = {
      ...message,
      retryCount: 2,
      job: 'noRetry',
      data: { id: 'noRetry' },
    }

    await redis.xadd(
      '__punt__:__default__',
      '*',
      'job',
      'noRetry',
      'message',
      JSON.stringify(noRetryMessage)
    )

    await listenForMessages({ recovery: false })
    await listenForMessages({ recovery: false })

    const [deadLetters] = await redis.xread(
      'COUNT',
      1,
      'STREAMS',
      '__punt__:__deadletter__',
      '0-0'
    )
    const [
      _topicName,
      [[_messageId, [_jobAttrName, job, _messageAttrName, jsonEncodedMessage]]],
    ] = deadLetters

    const decodedMessage = JSON.parse(jsonEncodedMessage)

    expect(job).toEqual('noRetry')
    expect(decodedMessage.data).toEqual({ id: 'noRetry' })
  })
})

describe('deadlettering messages after retries are exceeded', () => {
  beforeEach(async () => {
    await redis.xgroup(
      'CREATE',
      '__punt__:__default__',
      'workers',
      '$',
      'MKSTREAM'
    )
  })

  const errorFn = jest.fn(() => {
    throw new Error('job failed')
  })

  test('moves the message to the deadletter stream after retries are exhausted', async () => {
    const message = {
      data: { id: 'deadletterTest' },
      retryCount: 2,
      job: 'deadletterTest',
      lastAttemptedAt: Date.now() - 8_000,
      lastError: 'An error occurred',
    }

    worker('deadletterTest', errorFn, { maxRetries: 3 })

    await redis.xadd(
      '__punt__:__default__',
      '*',
      'job',
      'deadletterTest',
      'message',
      JSON.stringify(message)
    )

    await listenForMessages({ recovery: false })

    const [deadLetters] = await redis.xread(
      'COUNT',
      1,
      'STREAMS',
      '__punt__:__deadletter__',
      '0-0'
    )

    const [
      _topicName,
      [
        [
          _messageId,
          [_jobAttrName, _job, _messageAttrName, jsonEncodedMessage],
        ],
      ],
    ] = deadLetters

    const decodedMessage = JSON.parse(jsonEncodedMessage)

    expect(decodedMessage.data).toEqual({ id: 'deadletterTest' })
  })

  test('allow disabling retries completely with the retry option', async () => {
    const message = {
      data: { id: 'no-retry-test' },
      retryCount: 0,
      job: 'no-retry',
      lastAttemptedAt: Date.now() - 8_000,
      lastError: 'An error occurred',
    }

    worker('no-retry', errorFn, { retry: false })

    await redis.xadd(
      '__punt__:__default__',
      '*',
      'job',
      'no-retry',
      'message',
      JSON.stringify(message)
    )

    await listenForMessages({ recovery: false })

    const [deadLetters] = await redis.xread(
      'COUNT',
      1,
      'STREAMS',
      '__punt__:__deadletter__',
      '0-0'
    )

    const [
      _topicName,
      [
        [
          _messageId,
          [_jobAttrName, _job, _messageAttrName, jsonEncodedMessage],
        ],
      ],
    ] = deadLetters

    const decodedMessage = JSON.parse(jsonEncodedMessage)

    expect(decodedMessage.data).toEqual({ id: 'no-retry-test' })
  })
})

describe('retryMonitor', () => {
  it('fetches items from the retry sorted set that can be reprocessed', async () => {
    const nextExecution = Date.now() - 1
    const message = {
      job: 'myjob',
      data: { id: 'ill-be-back' },
      retryCount: 1,
      lastAttemptedAt: nextExecution - 1_000, //one second ago
    }

    await redis.zadd(
      '__punt__:__retryset__',
      nextExecution.toString(),
      JSON.stringify(message)
    )

    await retryMonitor()

    const [result] = await redis.xread(
      'COUNT',
      1,
      'STREAMS',
      '__punt__:__default__',
      '0-0'
    )

    const [
      _topic,
      [
        [
          _messageId,
          [_jobAttrName, _job, _messageAttrName, jsonEncodedMessage],
        ],
      ],
    ] = result

    const decodedMessage = JSON.parse(jsonEncodedMessage)

    expect(decodedMessage.data).toEqual({ id: 'ill-be-back' })
  })

  it('puts back an item that isnt ready to be reprocessed', async () => {
    const currentTime = Date.now()
    const nextExecution = currentTime + 1_000 //one second from now
    const message = {
      job: 'myjob',
      data: { id: 'ill-be-back' },
      retryCount: 1,
      lastAttemptedAt: nextExecution - 1_000, //one second ago
    }

    await redis.zadd(
      '__punt__:__retryset__',
      nextExecution.toString(),
      JSON.stringify(message)
    )

    await retryMonitor({ ts: currentTime })

    const result = await redis.xread(
      'COUNT',
      1,
      'STREAMS',
      '__punt__:__default__',
      '0-0'
    )

    expect(result).toBeNull()

    const retrySet = await redis.zrange(
      '__punt__:__retryset__',
      0,
      -1,
      'WITHSCORES'
    )

    expect(retrySet[1]).toEqual(nextExecution.toString())
  })

  it('gracefully handles empty sets', async () => {
    const result = await retryMonitor()

    expect(result).toBeUndefined()
  })
})

describe('shutting down', () => {
  worker('myjob', myfn)

  test('sets the termination flag', () => {
    shutdown()

    expect(isTerminating()).toBe(true)
  })
})
