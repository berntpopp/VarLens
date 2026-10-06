/**
 * Owner-checked job control at the HTTP boundary (P-07, PR-W4/PR-W6).
 *
 * Before: `import:cancel` / `batch-import:cancel` called a process-wide
 * cancel, so any logged-in user could stop another user's import, and
 * `jobs:list` showed every user's jobs. Now jobs started inside a request
 * are owned by that request's user; other non-admin users neither see nor
 * cancel them (403 FORBIDDEN), admins see and may cancel all of them.
 */
import { afterEach, describe, expect, test } from 'vitest'
import fastify, { type FastifyInstance } from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'

import { JobRunner } from '../../src/main/services/jobs/JobRunner'
import type { Job } from '../../src/shared/types/jobs'
import { buildDispatcher, registerDispatcher } from '../../src/web/server/dispatcher'
import { WebEventHub } from '../../src/web/server/events'
import { WebJobRegistry } from '../../src/web/server/jobs/web-job-registry'
import type { OverrideHandler } from '../../src/web/server/routes/types'
import { makeDeps } from './helpers/dispatcher-adapters'

const USERS: Record<string, { id: number; username: string; role: string }> = {
  alice: { id: 1, username: 'alice', role: 'user' },
  bob: { id: 2, username: 'bob', role: 'user' },
  root: { id: 3, username: 'root', role: 'admin' }
}

let app: FastifyInstance | undefined
afterEach(async () => {
  await app?.close()
  app = undefined
})

/**
 * Test-only override standing in for an import request: it enqueues a
 * blocking `kind` job exactly like PostgresImportExecutor does — deep in
 * shared logic, with no user id passed — and returns its id.
 */
function startJobOverride(runner: JobRunner): OverrideHandler {
  return {
    handle(args) {
      const kind = args[0] as Job['kind']
      const handle = runner.enqueue(kind, { caseName: 'HG005' }, (ctx) => {
        return new Promise((_resolve, reject) => {
          ctx.signal.addEventListener('abort', () => {
            const error = new Error('cancelled')
            error.name = 'AbortError'
            reject(error)
          })
        })
      })
      handle.result.catch(() => undefined)
      return { jobId: handle.id }
    }
  }
}

function setup() {
  const { deps } = makeDeps()
  const runner = new JobRunner()
  const events = new WebEventHub()
  const registry = new WebJobRegistry(runner, events)
  deps.events = events
  deps.jobs = { runner, registry, caseDelete: {} as never }

  app = fastify()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  app.addHook('preHandler', async (request) => {
    const user = USERS[String(request.headers['x-test-user'])]
    request.session = { user: { ...user, passwordChangedAt: null } } as never
  })
  registerDispatcher(app, deps, {
    ...buildDispatcher(deps).overrides,
    'test:startJob': startJobOverride(runner)
  })

  const call = async (user: string, domain: string, method: string, ...args: unknown[]) => {
    const res = await app!.inject({
      method: 'POST',
      url: `/api/${domain}/${method}`,
      headers: { 'x-test-user': user },
      payload: { args }
    })
    const body = res.body === '' ? null : (res.json() as Record<string, unknown> | null)
    return { status: res.statusCode, body }
  }
  return { runner, call }
}

describe('job ownership over HTTP (two users + admin)', () => {
  test("user B cannot cancel user A's import; A can", async () => {
    const { runner, call } = setup()
    const started = await call('alice', 'test', 'startJob', 'import_single')
    const jobId = String(started.body?.jobId)

    const denied = await call('bob', 'import', 'cancel')
    expect(denied.status).toBe(403)
    expect(denied.body).toMatchObject({ code: 'FORBIDDEN' })
    expect(runner.get(jobId)?.status).toBe('running')

    const deniedById = await call('bob', 'jobs', 'cancel', jobId)
    expect(deniedById.status).toBe(403)
    expect(runner.get(jobId)?.status).toBe('running')

    const own = await call('alice', 'import', 'cancel')
    expect(own.status).toBe(200)
    await new Promise((resolve) => setImmediate(resolve))
    expect(runner.get(jobId)?.status).toBe('cancelled')
  })

  test("user B cannot cancel user A's batch import; an admin can", async () => {
    const { runner, call } = setup()
    const started = await call('alice', 'test', 'startJob', 'import_batch')
    const jobId = String(started.body?.jobId)

    expect((await call('bob', 'batch-import', 'cancel')).status).toBe(403)
    expect(runner.get(jobId)?.status).toBe('running')

    expect((await call('root', 'batch-import', 'cancel')).status).toBe(200)
    await new Promise((resolve) => setImmediate(resolve))
    expect(runner.get(jobId)?.status).toBe('cancelled')
  })

  test('jobs are visible to their owner and admins only', async () => {
    const { call } = setup()
    const started = await call('alice', 'test', 'startJob', 'export')
    const jobId = String(started.body?.jobId)

    const aliceList = (await call('alice', 'jobs', 'list')).body as unknown as Job[]
    expect(aliceList.map((job) => job.id)).toEqual([jobId])
    expect(aliceList[0].owner).toEqual({ userId: 1, username: 'alice' })

    expect((await call('bob', 'jobs', 'list')).body).toEqual([])
    expect((await call('bob', 'jobs', 'get', jobId)).body).toBeNull()
    expect((await call('bob', 'jobs', 'progress', jobId)).body).toBeNull()

    const adminList = (await call('root', 'jobs', 'list')).body as unknown as Job[]
    expect(adminList.map((job) => job.id)).toEqual([jobId])
    expect((await call('root', 'jobs', 'cancel', jobId)).body).toEqual({ requested: true })
  })

  test('cancel with nothing running is a no-op for everyone', async () => {
    const { call } = setup()
    expect((await call('bob', 'import', 'cancel')).status).toBe(200)
    expect((await call('bob', 'jobs', 'cancel', 'NOSUCHJOB')).body).toEqual({ requested: false })
  })
})
