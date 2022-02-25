import { randomUUID } from 'crypto'
import punt from './punt'

import Redis from 'ioredis'

const redis = new Redis()

afterEach(async () => {
  await redis.flushdb()
})

describe('punt', () => {
  test('enqueuing messages to punt', async () => {
    let uuid = randomUUID()
    let enqueuedMessageId = await punt('testEnqueue', { id: uuid })

    let [[_stream, [message]]] = await redis.xread(
      'STREAMS',
      '__punt__:__default__',
      0
    )

    let [messageId, [topicLabel, topicName, messageLabel, jsonEncodedMessage]] =
      message

    let decodedMessage = JSON.parse(jsonEncodedMessage)

    expect(messageId).toBe(enqueuedMessageId)
    expect(topicLabel).toBe('job')
    expect(topicName).toBe('testEnqueue')
    expect(messageLabel).toBe('message')
    expect(decodedMessage.data.id).toBe(uuid)
  })

  test('setting default message attributes', async () => {
    let uuid = randomUUID()
    await punt('testEnqueue', { id: uuid })

    let [[_stream, [message]]] = await redis.xread(
      'STREAMS',
      '__punt__:__default__',
      0
    )

    let [
      _messageId,
      [_topicLabel, _topicName, _messageLabel, jsonEncodedMessage],
    ] = message

    let decodedMessage = JSON.parse(jsonEncodedMessage)

    expect(decodedMessage.data.id).toBe(uuid)
    expect(decodedMessage.job).toBe('testEnqueue')
    expect(decodedMessage.retryCount).toBe(0)
    expect(decodedMessage.lastAttemptedAt).toBeNull
    expect(decodedMessage.lastError).toBeNull
  })
})
