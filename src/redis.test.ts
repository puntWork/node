import { redisUrl, redisOptions } from './redis'
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

describe('redisOptions', () => {
  const config = {
    redisUrl: 'redis://redis:6379',
    redisOptions: {
      tls: {
        rejectUnauthorized: true,
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

    test('Redis options from the config file', () => {
      expect(redisOptions('rediss://redis:6379')).toEqual({
        tls: {
          rejectUnauthorized: true,
        },
      })
    })

    test('precedence of the REDIS_TLS_REJECT_UNAUTHORIZED environment variable over the config file', () => {
      process.env.REDIS_TLS_REJECT_UNAUTHORIZED = '0'

      expect(redisOptions(`rediss://redis:6379`)).toEqual({
        tls: {
          rejectUnauthorized: false,
        },
      })

      process.env.REDIS_TLS_REJECT_UNAUTHORIZED = ''
    })

    test('stripping out the TLS options from the config file if the connection is not encrypted', () => {
      expect(redisOptions('redis://redis:6379')).toEqual({})
    })
  })

  describe('without a config file', () => {
    test('default Redis options', () => {
      mockedLoadConfiguration.mockReturnValue({})

      expect(redisOptions('rediss://redis:6379')).toEqual({})
    })
  })
})
