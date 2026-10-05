import { openDatabase } from '../server/database'
import { createApplication, REQUIRED_REQUEST_HEADER } from '../server/app'
import type { ServerConfig } from '../server/config'

export const TEST_PASSPHRASE = 'correct horse battery staple'
export const TEST_SETUP_TOKEN = 'TESTSETUPTOKEN'

export function createTestConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    listenPort: 0,
    listenHost: '127.0.0.1',
    dataDirectory: ':memory:',
    publicAssetsDirectory: '/nonexistent',
    cookieSecure: true,
    trustProxy: true,
    publicOrigin: null,
    sessionIdleMinutes: 30,
    sessionMaxHours: 12,
    setupToken: TEST_SETUP_TOKEN,
    setupTokenWasGenerated: false,
    // Low cost so tests run fast; production default is 2^17.
    scryptParameters: { costFactorN: 2 ** 10, blockSizeR: 8, parallelizationP: 1 },
    ...overrides,
  }
}

/** A tiny cookie-carrying client around app.request, like a single browser. */
export function createTestHarness(configOverrides: Partial<ServerConfig> = {}) {
  let fakeNowMilliseconds = Date.parse('2026-10-05T12:00:00Z')
  const database = openDatabase(':memory:')
  const { app } = createApplication({
    config: createTestConfig(configOverrides),
    database,
    staticAssets: new Map(),
    currentTimeMilliseconds: () => fakeNowMilliseconds,
  })

  const createBrowser = (ipAddress = '203.0.113.10') => {
    let cookieHeader = ''
    const request = async (method: string, urlPath: string, body?: unknown, extraHeaders: Record<string, string> = {}) => {
      const headers: Record<string, string> = {
        'x-forwarded-for': ipAddress,
        host: 'journal.example.com',
        ...extraHeaders,
      }
      if (method !== 'GET') headers[REQUIRED_REQUEST_HEADER] = '1'
      if (body !== undefined) headers['content-type'] = 'application/json'
      if (cookieHeader) headers.cookie = cookieHeader
      const response = await app.request(urlPath, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const setCookieHeader = response.headers.get('set-cookie')
      if (setCookieHeader) {
        const [cookiePair] = setCookieHeader.split(';')
        cookieHeader = cookiePair!.endsWith('=') ? '' : cookiePair!
      }
      return response
    }
    return { request, clearCookies: () => (cookieHeader = '') }
  }

  return {
    app,
    database,
    createBrowser,
    advanceTime: (milliseconds: number) => (fakeNowMilliseconds += milliseconds),
    now: () => fakeNowMilliseconds,
  }
}
