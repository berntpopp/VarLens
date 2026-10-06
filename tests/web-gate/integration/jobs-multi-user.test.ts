import { describe, expect, test } from 'vitest'
import { Pool } from 'pg'

import type { Job } from '../../../src/shared/types/jobs'
import { PostgresWebAuthService } from '../../../src/web/auth/PostgresWebAuthService'
import { SAME_ORIGIN_HEADERS, startWebDriver, type WebDriver } from '../helpers/web-driver'

/**
 * Multi-user jobs against the real Postgres stack (PR-W6, P-07/P-13):
 * a job belongs to the user whose request started it; another non-admin user
 * cannot see or cancel it; the admin sees it. Logout revokes the cookie
 * itself, not just the browser's copy.
 */
const PG_URL = process.env.VARLENS_PG_URL ?? ''
const HAS_PG = PG_URL !== ''

interface Res {
  statusCode: number
  body: string
  headers: Record<string, string | string[] | undefined>
  json: () => unknown
}

function cookiesOf(res: Res): string {
  const raw = res.headers['set-cookie']
  if (raw === undefined) return ''
  return (Array.isArray(raw) ? raw : [raw]).map((c) => String(c).split(';')[0]).join('; ')
}

async function call(driver: WebDriver, cookie: string, path: string, args: unknown[] = []) {
  return (await driver.app.inject({
    method: 'POST',
    url: `/api/${path}`,
    payload: { args },
    headers: { ...SAME_ORIGIN_HEADERS, cookie }
  })) as unknown as Res
}

/** Create a user, log in, rotate the temporary password; return a usable cookie. */
async function userSession(driver: WebDriver, username: string): Promise<string> {
  const temp = `${username}-temporary-2026`
  const active = `${username}-active-password-2026`
  const pool = new Pool({ connectionString: PG_URL, max: 1 })
  try {
    const auth = new PostgresWebAuthService({ pool, schema: driver.schema })
    await auth.createUser(username, username, temp, 'web-gate-admin')
  } finally {
    await pool.end()
  }
  const login = await call(driver, '', 'auth/login', [username, temp])
  expect(login.statusCode, login.body).toBe(200)
  let cookie = cookiesOf(login)
  const rotate = await call(driver, cookie, 'auth/changePassword', [temp, active])
  expect(rotate.statusCode, rotate.body).toBe(200)
  cookie = cookiesOf(rotate) || cookie
  // First authenticated call assigns the browser-session id (sid).
  const warm = await call(driver, cookie, 'cases/list')
  expect(warm.statusCode, warm.body).toBe(200)
  return cookiesOf(warm) || cookie
}

async function seedCase(pool: Pool, schema: string, name: string): Promise<number> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO "${schema}".cases (name, file_path, file_size, created_at, variant_count)
       VALUES ($1, '/tmp/seed.vcf', 0, 0, 10) RETURNING id`,
    [name]
  )
  return Number(res.rows[0].id)
}

describe.skipIf(!HAS_PG)('jobs across users (web/Postgres)', () => {
  test("a user's job is invisible and uncancellable for another user, visible to admin", async () => {
    const driver = await startWebDriver()
    const pool = new Pool({ connectionString: PG_URL, max: 2 })
    try {
      const alice = await userSession(driver, 'alice')
      const bob = await userSession(driver, 'bob')
      const caseId = await seedCase(pool, driver.schema, 'alice-case')

      const started = await call(driver, alice, 'cases/startDelete', [
        { mode: 'ids', ids: [caseId] }
      ])
      expect(started.statusCode, started.body).toBe(200)
      const { jobId } = started.json() as { jobId: string }

      const asBob = await call(driver, bob, 'jobs/get', [jobId])
      expect(asBob.statusCode).toBe(200)
      expect(asBob.json()).toBeNull()
      expect((await call(driver, bob, 'jobs/list')).json()).toEqual([])

      const aliceView = (await call(driver, alice, 'jobs/get', [jobId])).json() as Job
      expect(aliceView.owner).toMatchObject({ username: 'alice' })

      const adminList = (await driver.api('jobs', 'list')).json() as Job[]
      expect(adminList.map((job) => job.id)).toContain(jobId)

      const bobCancel = await call(driver, bob, 'jobs/cancel', [jobId])
      // 403 while the delete still runs; once it finished, cancel is a no-op.
      if (bobCancel.statusCode !== 200) {
        expect(bobCancel.statusCode, bobCancel.body).toBe(403)
        expect(bobCancel.json()).toMatchObject({ code: 'FORBIDDEN' })
      } else {
        expect(bobCancel.json()).toEqual({ requested: false })
      }
    } finally {
      await pool.end()
      await driver.close()
    }
  }, 60_000)

  test('bob cannot cancel the import of alice (import:cancel / batch-import:cancel)', async () => {
    const driver = await startWebDriver()
    try {
      const alice = await userSession(driver, 'alice2')
      const bob = await userSession(driver, 'bob2')
      const { jobRunner } = await import('../../../src/main/services/jobs/runner')
      const { runAsJobActor } = await import('../../../src/web/server/jobs/job-actor')

      // Alice's running import, enqueued the way PostgresImportExecutor does it.
      const me = (await call(driver, alice, 'auth/currentUser')).json() as { id: number }
      const handle = runAsJobActor({ userId: me.id, username: 'alice2', role: 'user' }, () =>
        jobRunner.enqueue('import_single', { caseName: 'HG005' }, (ctx) => {
          return new Promise((_resolve, reject) => {
            ctx.signal.addEventListener('abort', () => {
              const error = new Error('cancelled')
              error.name = 'AbortError'
              reject(error)
            })
          })
        })
      )
      handle.result.catch(() => undefined)

      const denied = await call(driver, bob, 'import/cancel')
      expect(denied.statusCode, denied.body).toBe(403)
      expect((await call(driver, bob, 'batch-import/cancel')).statusCode).toBe(403)
      expect(jobRunner.get(handle.id)?.status).toBe('running')

      const own = await call(driver, alice, 'import/cancel')
      expect(own.statusCode, own.body).toBe(200)
      await expect(handle.result).rejects.toThrow('cancelled')
      expect(jobRunner.get(handle.id)?.status).toBe('cancelled')
    } finally {
      await driver.close()
    }
  }, 60_000)

  test('logout revokes the cookie: a copy captured before logout is rejected', async () => {
    const driver = await startWebDriver()
    try {
      const carol = await userSession(driver, 'carol')
      const logout = await call(driver, carol, 'auth/logout')
      expect(logout.statusCode, logout.body).toBe(200)

      const replayed = await call(driver, carol, 'cases/list')
      expect(replayed.statusCode, replayed.body).toBe(401)
    } finally {
      await driver.close()
    }
  }, 60_000)
})
