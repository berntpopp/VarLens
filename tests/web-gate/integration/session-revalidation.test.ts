import { describe, expect, test } from 'vitest'
import { Pool } from 'pg'

import { SAME_ORIGIN_HEADERS, startWebDriver, type WebDriver } from '../helpers/web-driver'
import { PostgresWebAuthService } from '../../../src/web/auth/PostgresWebAuthService'

const HAS_PG = typeof process.env.VARLENS_PG_URL === 'string' && process.env.VARLENS_PG_URL !== ''

interface InjectResult {
  statusCode: number
  body: string
  headers: Record<string, string | string[] | undefined>
}

function extractCookies(res: InjectResult): string {
  const setCookie = res.headers['set-cookie']
  if (setCookie === undefined) return ''
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie]
  return arr.map((cookie) => String(cookie).split(';')[0]).join('; ')
}

async function loginAs(driver: WebDriver, username: string, password: string): Promise<string> {
  const loginRes = (await driver.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { args: [username, password] },
    headers: SAME_ORIGIN_HEADERS
  })) as unknown as InjectResult
  expect(loginRes.statusCode, loginRes.body).toBe(200)

  const cookie = extractCookies(loginRes)
  expect(cookie).not.toBe('')
  return cookie
}

async function apiWithCookie(
  driver: WebDriver,
  cookie: string,
  domain: string,
  method: string,
  ...args: unknown[]
): Promise<InjectResult> {
  return (await driver.app.inject({
    method: 'POST',
    url: `/api/${domain}/${method}`,
    payload: { args },
    headers: { ...SAME_ORIGIN_HEADERS, cookie }
  })) as unknown as InjectResult
}

async function withAuthService<T>(
  driver: WebDriver,
  fn: (authService: PostgresWebAuthService) => Promise<T>
): Promise<T> {
  const pgUrl = process.env.VARLENS_PG_URL
  if (pgUrl === undefined || pgUrl.trim() === '') {
    throw new Error('VARLENS_PG_URL is required')
  }
  const pool = new Pool({ connectionString: pgUrl })
  try {
    return await fn(new PostgresWebAuthService({ pool, schema: driver.schema }))
  } finally {
    await pool.end()
  }
}

async function createRotatedUser(
  driver: WebDriver,
  username: string
): Promise<{ cookie: string; password: string }> {
  const tempPassword = `${username}-temporary-2026`
  const activePassword = `${username}-active-password-2026`

  await withAuthService(driver, async (authService) => {
    await authService.createUser(username, username, tempPassword, 'web-gate-admin')
  })

  let cookie = await loginAs(driver, username, tempPassword)
  const rotateRes = await apiWithCookie(
    driver,
    cookie,
    'auth',
    'changePassword',
    tempPassword,
    activePassword
  )
  expect(rotateRes.statusCode, rotateRes.body).toBe(200)
  cookie = extractCookies(rotateRes) || cookie

  const usableRes = await apiWithCookie(driver, cookie, 'cases', 'list')
  expect(usableRes.statusCode, usableRes.body).toBe(200)

  return { cookie, password: activePassword }
}

describe.skipIf(!HAS_PG)('web session revalidation', () => {
  test('deactivating a user invalidates their existing session before route dispatch', async () => {
    const driver = await startWebDriver()
    try {
      const username = 'stale-deactivate'
      const { cookie } = await createRotatedUser(driver, username)

      const deactivateRes = await driver.api('auth', 'deactivateUser', username)
      expect(deactivateRes.statusCode, deactivateRes.body).toBe(200)

      const staleRes = await apiWithCookie(driver, cookie, 'cases', 'list')
      expect(staleRes.statusCode, staleRes.body).toBe(401)
      expect(staleRes.body).toContain('session no longer valid')
    } finally {
      await driver.close()
    }
  })

  test('resetting a password invalidates sessions issued before the reset', async () => {
    const driver = await startWebDriver()
    try {
      const username = 'stale-reset'
      const { cookie } = await createRotatedUser(driver, username)

      const resetRes = await driver.api(
        'auth',
        'resetPassword',
        username,
        'stale-reset-new-temporary-2026'
      )
      // 202 { accepted: true } for any username (no enumeration).
      expect(resetRes.statusCode, resetRes.body).toBe(202)

      const staleRes = await apiWithCookie(driver, cookie, 'cases', 'list')
      expect(staleRes.statusCode, staleRes.body).toBe(401)
      expect(staleRes.body).toContain('session no longer valid')
    } finally {
      await driver.close()
    }
  })
})
