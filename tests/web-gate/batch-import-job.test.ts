/**
 * `batch-import:start` over HTTP is a job, not a held request.
 *
 * Before: the request stayed open until the last file of the batch was
 * imported and returned the result as its body. A proxy timeout cut it, and
 * so did a browser reload; the batch kept running but its result was lost.
 *
 * After: the start call answers as soon as the batch is accepted, with the
 * job id. The result is published as `batch-import:complete` (failure:
 * `batch-import:failed`) and stays readable through `batch-import:status`.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { jobRunner } from '../../src/main/services/jobs/runner'
import { BatchImportRuns, SETTLED_RUN_TTL_MS } from '../../src/web/server/batch-import-runs'
import { buildDispatcher } from '../../src/web/server/dispatcher'
import { DISPATCHER_SECURITY_MAP } from '../../src/web/server/security/operation-security-map'
import { stageExistingFileUpload } from '../../src/web/server/routes/upload-staging'
import { makeDeps } from './helpers/dispatcher-adapters'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const IMPORTED = { caseId: 12, variantCount: 4, skipped: 0, errors: [], elapsed: 15 }
const alice = { session: { user: { id: 7, username: 'alice', role: 'analyst' } } }
const bob = { session: { user: { id: 8, username: 'bob', role: 'analyst' } } }
const root = { session: { user: { id: 1, username: 'root', role: 'admin' } } }

describe('batch-import:start as a job', () => {
  let tempDir: string
  let prevNodeEnv: string | undefined
  let prevRecoveryDir: string | undefined
  let runCounter = 0
  const nextRunId = (): string => `job-run-${Date.now()}-${runCounter++}`

  beforeEach(async () => {
    prevNodeEnv = process.env.NODE_ENV
    prevRecoveryDir = process.env.VARLENS_RECOVERY_KEY_DIR
    tempDir = await mkdtemp(join(tmpdir(), 'varlens-web-batch-job-'))
    process.env.NODE_ENV = 'production'
    process.env.VARLENS_RECOVERY_KEY_DIR = tempDir
  })

  afterEach(async () => {
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = prevNodeEnv
    if (prevRecoveryDir === undefined) delete process.env.VARLENS_RECOVERY_KEY_DIR
    else process.env.VARLENS_RECOVERY_KEY_DIR = prevRecoveryDir
    await rm(tempDir, { recursive: true, force: true })
  })

  async function setup(): Promise<{
    start: (request: unknown, runId: string) => Promise<unknown>
    status: (request: unknown, runId: string) => Promise<{ state: string; [key: string]: unknown }>
    gate: Deferred<typeof IMPORTED>
    deps: ReturnType<typeof makeDeps>['deps']
    reply: ReturnType<typeof makeDeps>['reply']
    uploadRef: string
  }> {
    const sourcePath = join(tempDir, 'Case J.json')
    await writeFile(sourcePath, '{}')
    const upload = await stageExistingFileUpload({
      userId: 7,
      originalName: 'Case J.json',
      sourcePath
    })
    const { deps, importSingleFile, reply } = makeDeps()
    const gate = deferred<typeof IMPORTED>()
    importSingleFile.mockImplementationOnce(() => gate.promise)
    const { overrides } = buildDispatcher(deps)
    const call = (key: string, args: unknown[], request: unknown): Promise<unknown> =>
      Promise.resolve(
        (overrides[key].handle as (...a: unknown[]) => unknown)(args, request, reply, deps)
      )
    return {
      start: (request, runId) =>
        call('batch-import:start', [[upload.ref], 'skip', undefined, runId], request),
      status: (request, runId) =>
        call('batch-import:status', [runId], request) as Promise<{ state: string }>,
      gate,
      deps,
      reply,
      uploadRef: upload.ref
    }
  }

  const settledStatus = async (
    status: (request: unknown, runId: string) => Promise<{ state: string; [key: string]: unknown }>,
    runId: string
  ): Promise<{ state: string; [key: string]: unknown }> => {
    for (let attempt = 0; attempt < 2000; attempt++) {
      const current = await status(alice, runId)
      if (current.state !== 'running') return current
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error('run did not settle')
  }

  test('answers with the job id while the import is still running', async () => {
    const { start, status, gate, deps, reply } = await setup()
    const runId = nextRunId()

    // The import cannot finish before the gate opens, yet the call returns.
    const accepted = (await start(alice, runId)) as { accepted: boolean; jobId: string }
    expect(accepted).toEqual({ accepted: true, jobId: expect.any(String), runId })
    expect(reply.code).not.toHaveBeenCalled()
    expect(jobRunner.get(accepted.jobId)).toMatchObject({ kind: 'import_batch' })
    expect(await status(alice, runId)).toEqual({ state: 'running', jobId: accepted.jobId })
    expect(deps.events.publish).not.toHaveBeenCalledWith(
      7,
      'batch-import:complete',
      expect.anything()
    )

    gate.resolve(IMPORTED)
    const done = await settledStatus(status, runId)
    expect(done).toMatchObject({
      state: 'completed',
      jobId: accepted.jobId,
      result: { succeeded: 1, failed: 0, skipped: 0, cancelled: false }
    })
    // The completion event carries the same result, tagged with the run id.
    expect(deps.events.publish).toHaveBeenCalledWith(7, 'batch-import:complete', {
      ...(done.result as object),
      runId
    })
    expect(jobRunner.get(accepted.jobId)).toMatchObject({ status: 'completed' })
  })

  test('the result survives a reload: status is owner-scoped and readable afterwards', async () => {
    const { start, status, gate } = await setup()
    const runId = nextRunId()
    await start(alice, runId)

    // Another analyst cannot tell the run exists; an admin can follow it.
    expect(await status(bob, runId)).toEqual({ state: 'unknown' })
    expect((await status(root, runId)).state).toBe('running')

    gate.resolve(IMPORTED)
    await settledStatus(status, runId)
    // A fresh page (no promise, no event listener) asks again and gets it.
    expect(await status(alice, runId)).toMatchObject({
      state: 'completed',
      result: { succeeded: 1 }
    })
    expect(await status(bob, runId)).toEqual({ state: 'unknown' })
    expect(await status(alice, 'never-started')).toEqual({ state: 'unknown' })
  })

  test('a cancelled batch settles as a cancelled result', async () => {
    const { start, status, gate } = await setup()
    const runId = nextRunId()
    const accepted = (await start(alice, runId)) as { jobId: string }

    await jobRunner.cancel(accepted.jobId)
    gate.reject(new Error('Import cancelled'))

    const done = await settledStatus(status, runId)
    expect(done).toMatchObject({ state: 'completed', result: { cancelled: true, succeeded: 0 } })
    expect(jobRunner.get(accepted.jobId)).toMatchObject({ status: 'cancelled' })
  })

  test('a batch that cannot run is reported as failed, by event and by status', async () => {
    const { start, status, deps } = await setup()
    const runId = nextRunId()
    ;(
      deps.session.listCases as unknown as { mockRejectedValueOnce: (e: Error) => void }
    ).mockRejectedValueOnce(new Error('connection terminated'))

    const accepted = (await start(alice, runId)) as { accepted: boolean; jobId: string }
    expect(accepted.accepted).toBe(true)

    const done = await settledStatus(status, runId)
    expect(done).toMatchObject({
      state: 'failed',
      jobId: accepted.jobId,
      error: { code: expect.any(String), message: expect.stringContaining('connection terminated') }
    })
    expect((done.error as Record<string, unknown>).stack).toBeUndefined()
    expect(deps.events.publish).toHaveBeenCalledWith(7, 'batch-import:failed', {
      runId,
      jobId: accepted.jobId,
      error: done.error
    })
  })

  test('refuses a run id that is already tracked', async () => {
    const { start, status, gate, reply } = await setup()
    const runId = nextRunId()
    await start(alice, runId)
    gate.resolve(IMPORTED)
    await settledStatus(status, runId)

    expect(await start(alice, runId)).toMatchObject({ error: 'invalid-run-id' })
    expect(reply.code).toHaveBeenCalledWith(400)
  })
})

describe('batch-import:status security policy', () => {
  test('is a poll: role-gated and owner-scoped, but not audited per tick', () => {
    const policy = DISPATCHER_SECURITY_MAP['batch-import:status']
    // A client polls it every 15 s for the whole batch; the start is the audited write.
    expect(policy).toMatchObject({ kind: 'read', minRole: 'analyst' })
    expect(policy.audit).toMatchObject({ mode: 'exempt' })
    expect(DISPATCHER_SECURITY_MAP['jobs:get'].audit).toMatchObject({ mode: 'exempt' })
    expect(DISPATCHER_SECURITY_MAP['batch-import:start'].kind).toBe('write')
  })
})

describe('BatchImportRuns', () => {
  const result = { succeeded: 1, failed: 0, skipped: 0, cancelled: false, details: [] }
  const owner = { userId: 7, isAdmin: false }

  test('forgets a settled run after its retention time, never a running one', () => {
    let now = 1_000
    const runs = new BatchImportRuns(() => now)
    runs.start('running', 7, 'job-a')
    runs.start('done', 7, 'job-b')
    runs.complete('done', result)

    now += SETTLED_RUN_TTL_MS - 1
    expect(runs.status('done', owner).state).toBe('completed')
    now += 2
    expect(runs.status('done', owner)).toEqual({ state: 'unknown' })
    expect(runs.status('running', owner)).toEqual({ state: 'running', jobId: 'job-a' })
    expect(runs.has('done')).toBe(false)
  })

  test('bounds the number of settled runs it keeps', () => {
    let now = 0
    const runs = new BatchImportRuns(() => now)
    for (let index = 0; index < 250; index++) {
      runs.start(`run-${index}`, 7, `job-${index}`)
      now += 1
      runs.complete(`run-${index}`, result)
    }
    expect(runs.status('run-0', owner)).toEqual({ state: 'unknown' })
    expect(runs.status('run-249', owner).state).toBe('completed')
  })
})
