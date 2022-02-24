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
    expect(decodedMessage.id).toBe(uuid)
  })
})
