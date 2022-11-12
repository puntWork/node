import { randomUUID } from 'crypto'
import Punt from './punt'

import Redis from 'ioredis'

const redis = new Redis()

afterEach(async () => {
  await redis.flushdb()
})

describe('punt', () => {
  const punt = Punt()

  test('enqueuing messages to punt', async () => {
    const uuid = randomUUID()
    const enqueuedMessageId = await punt('testEnqueue', { id: uuid })

    const [[_stream, [message]]] = await redis.xread(
      'STREAMS',
      '__punt__:__default__',
      0
    )

    const [
      messageId,
      [topicLabel, topicName, messageLabel, jsonEncodedMessage],
    ] = message

    const decodedMessage = JSON.parse(jsonEncodedMessage)

    expect(messageId).toBe(enqueuedMessageId)
    expect(topicLabel).toBe('job')
    expect(topicName).toBe('testEnqueue')
    expect(messageLabel).toBe('message')
    expect(decodedMessage.data.id).toBe(uuid)
  })

  test('setting default message attributes', async () => {
    const uuid = randomUUID()
    await punt('testEnqueue', { id: uuid })

    const [[_stream, [message]]] = await redis.xread(
      'STREAMS',
      '__punt__:__default__',
      0
    )

    const [
      _messageId,
      [_topicLabel, _topicName, _messageLabel, jsonEncodedMessage],
    ] = message

    const decodedMessage = JSON.parse(jsonEncodedMessage)

    expect(decodedMessage.data.id).toBe(uuid)
    expect(decodedMessage.job).toBe('testEnqueue')
    expect(decodedMessage.retryCount).toBe(0)
    expect(decodedMessage.lastAttemptedAt).toBeNull
    expect(decodedMessage.lastError).toBeNull
  })
})
