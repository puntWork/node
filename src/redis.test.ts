import { redisUrl } from './redis'
import { loadConfiguration } from './lib/loadConfiguration'
jest.mock('./lib/loadConfiguration')

const mockedLoadConfiguration = jest.mocked(loadConfiguration, true)

describe('redisUrl', () => {
  const config = {
    redisUrl: 'redis://redis:6379',
    redisOptions: {
      tls: {
        rejectUnauthorized: false,
      },
    },
  }

  describe('with a config file', () => {
    beforeAll(() => {
      mockedLoadConfiguration.mockReturnValue(config)
    })

    afterAll(() => {
      jest.unmock('./lib/loadConfiguration')
    })

    test('Redis URL from the config file', () => {
      expect(redisUrl()).toEqual('redis://redis:6379')
    })

    test('precedence of the environment variable over the config file', () => {
      process.env.REDIS_URL = 'redis://localhost:6380'

      expect(redisUrl()).toEqual('redis://localhost:6380')

      process.env.REDIS_URL = ''
    })
  })

  describe('without a config file', () => {
    test('default Redis URL', () => {
      mockedLoadConfiguration.mockReturnValue({})

      expect(redisUrl()).toEqual('redis://localhost:6379')
    })
  })
})
