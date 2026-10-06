import { describe, expect, it } from 'vitest'

import { ForbiddenError } from '../../../../src/main/ipc/errors'
import { JobRunner } from '../../../../src/main/services/jobs/JobRunner'
import type { Job } from '../../../../src/shared/types/jobs'
import { WebEventHub, type WebEvent } from '../../../../src/web/server/events'
import { runAsJobActor } from '../../../../src/web/server/jobs/job-actor'
import { publicJobParams, WebJobRegistry } from '../../../../src/web/server/jobs/web-job-registry'

const ALICE = { userId: 1, username: 'alice', role: 'user' }
const BOB = { userId: 2, username: 'bob', role: 'user' }
const ADMIN = { userId: 3, username: 'root', role: 'admin' }

/** A job that runs until cancelled, started "inside a request" of `actor`. */
function startBlockingJob(runner: JobRunner, actor: typeof ALICE, kind: Job['kind']) {
  return runAsJobActor(actor, () =>
    runner.enqueue(kind, { caseName: 'HG005', filePath: '/srv/uploads/secret.vcf' }, (ctx) => {
      return new Promise((_resolve, reject) => {
        ctx.signal.addEventListener('abort', () => {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          reject(error)
        })
      })
    })
  )
}

function setup() {
  const runner = new JobRunner()
  const events = new WebEventHub()
  const registry = new WebJobRegistry(runner, events)
  return { runner, events, registry }
}

describe('WebJobRegistry (per-user job visibility and owner-checked cancel)', () => {
  it('records the request actor as owner and hides the job from other users', () => {
    const { runner, registry } = setup()
    const handle = startBlockingJob(runner, ALICE, 'import_single')
    handle.result.catch(() => undefined)

    expect(registry.get(ALICE, handle.id)).toMatchObject({
      id: handle.id,
      owner: { userId: 1, username: 'alice' }
    })
    expect(registry.get(BOB, handle.id)).toBeNull()
    expect(registry.list(BOB)).toEqual([])
    expect(registry.list(ADMIN).map((job) => job.id)).toEqual([handle.id])
  })

  it('never exposes server paths in job params', () => {
    const { runner, registry } = setup()
    const handle = startBlockingJob(runner, ALICE, 'import_single')
    handle.result.catch(() => undefined)
    expect(registry.get(ALICE, handle.id)?.params).toEqual({ caseName: 'HG005' })
    expect(
      publicJobParams({ files: [{ storedPath: '/x' }, { storedPath: '/y' }], runId: 'r', ids: [1] })
    ).toEqual({ filesCount: 2, runId: 'r', ids: [1] })
  })

  it("rejects another user's cancel with ForbiddenError and keeps the job running", async () => {
    const { runner, registry } = setup()
    const handle = startBlockingJob(runner, ALICE, 'import_single')
    handle.result.catch(() => undefined)

    await expect(registry.cancel(BOB, handle.id)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(registry.cancelActive(BOB, ['import_single'])).rejects.toBeInstanceOf(
      ForbiddenError
    )
    expect(runner.get(handle.id)?.status).toBe('running')

    await expect(registry.cancel(ALICE, handle.id)).resolves.toEqual({ requested: true })
    await expect(handle.result).rejects.toThrow('cancelled')
    expect(runner.get(handle.id)?.status).toBe('cancelled')
  })

  it('lets an admin cancel any job; finished or unknown jobs are a no-op', async () => {
    const { runner, registry } = setup()
    const handle = startBlockingJob(runner, ALICE, 'import_batch')
    handle.result.catch(() => undefined)

    await expect(registry.cancelActive(ADMIN, ['import_batch'])).resolves.toBe(1)
    await expect(handle.result).rejects.toThrow()
    await expect(registry.cancel(BOB, handle.id)).resolves.toEqual({ requested: false })
    await expect(registry.cancel(ALICE, 'NOSUCHJOB')).resolves.toEqual({ requested: false })
  })

  it('pushes jobs:changed to the owner and admins only', () => {
    const { runner, events } = setup()
    const seen: Record<string, WebEvent[]> = { alice: [], bob: [], root: [] }
    events.subscribe({ userId: 1, role: 'user' }, (e) => seen.alice.push(e))
    events.subscribe({ userId: 2, role: 'user' }, (e) => seen.bob.push(e))
    events.subscribe({ userId: 3, role: 'admin' }, (e) => seen.root.push(e))

    const handle = startBlockingJob(runner, ALICE, 'case_delete')
    handle.result.catch(() => undefined)

    expect(seen.alice.length).toBeGreaterThan(0)
    expect(seen.root.length).toBe(seen.alice.length)
    expect(seen.bob).toEqual([])
    expect(seen.alice.at(-1)).toMatchObject({
      type: 'jobs:changed',
      payload: { id: handle.id, status: 'running', owner: { username: 'alice' } }
    })
    void runner.cancel(handle.id)
  })

  it('a server-started job (no actor) is visible to admins only', () => {
    const { runner, registry } = setup()
    const handle = runner.enqueue('case_delete', { mode: 'all' }, () => new Promise(() => {}))
    expect(registry.get(ALICE, handle.id)).toBeNull()
    expect(registry.get(ADMIN, handle.id)).not.toBeNull()
    expect(registry.get(ADMIN, handle.id)?.owner).toBeUndefined()
  })
})
