import { describe, expect, it, vi } from 'vitest'

import { InvalidParametersError } from '../../../../src/main/ipc/errors'
import {
  CaseDeletionInterruptedError,
  type CaseDeletionOptions
} from '../../../../src/main/storage/postgres/PostgresCaseLifecycleRepository'
import { BackgroundJobRegistry } from '../../../../src/web/server/jobs/background-job-registry'
import {
  type CaseDeletionLifecycle,
  CaseDeleteJobRunner,
  CaseNotFoundError
} from '../../../../src/web/server/jobs/case-delete-jobs'

describe('BackgroundJobRegistry', () => {
  it('creates queued jobs, applies patches and notifies listeners with the owner', () => {
    const registry = new BackgroundJobRegistry()
    const seen: Array<[string, number | undefined]> = []
    registry.onUpdate((job, owner) => seen.push([job.status, owner]))

    const job = registry.create('case-delete', { type: 'case', id: 7 }, 42)
    expect(job).toMatchObject({ kind: 'case-delete', status: 'queued', subject: { id: 7 } })
    registry.update(job.id, { status: 'running', startedAt: 1 })

    expect(registry.get(job.id)?.status).toBe('running')
    expect(seen).toEqual([
      ['queued', 42],
      ['running', 42]
    ])
  })

  it('returns copies so callers cannot mutate registry state', () => {
    const registry = new BackgroundJobRegistry()
    const job = registry.create('case-delete', { type: 'case', id: 1 })
    job.status = 'failed'
    expect(registry.get(job.id)?.status).toBe('queued')
  })

  it('findActive dedupes per subject and ignores terminal jobs', () => {
    const registry = new BackgroundJobRegistry()
    const job = registry.create('case-delete', { type: 'case', id: 3 })
    expect(registry.findActive('case-delete', { type: 'case', id: 3 })?.id).toBe(job.id)
    expect(registry.findActive('case-delete', { type: 'case', id: 4 })).toBeUndefined()
    registry.update(job.id, { status: 'succeeded', finishedAt: Date.now() })
    expect(registry.findActive('case-delete', { type: 'case', id: 3 })).toBeUndefined()
  })

  it('prunes terminal jobs after the retention window but keeps active ones', () => {
    let now = 1_000
    const registry = new BackgroundJobRegistry({ retentionMs: 100, now: () => now })
    const done = registry.create('case-delete', { type: 'case', id: 1 })
    const active = registry.create('case-delete', { type: 'case', id: 2 })
    registry.update(done.id, { status: 'succeeded', finishedAt: now })

    now += 101
    expect(registry.get(done.id)).toBeUndefined()
    expect(registry.get(active.id)?.status).toBe('queued')
    expect(registry.list({ activeOnly: true }).map((j) => j.id)).toEqual([active.id])
  })
})

function fakeLifecycle(overrides: Partial<CaseDeletionLifecycle> = {}) {
  const calls: string[] = []
  const lifecycle: CaseDeletionLifecycle = {
    getCaseStatus: vi.fn(async () => 'ready' as const),
    hideCase: vi.fn(async (caseId: number) => {
      calls.push(`hide:${caseId}`)
      return { state: 'hidden' as const, genomeBuild: 'GRCh38', variantCount: 10 }
    }),
    completeHiddenDeletion: vi.fn(
      async (caseId: number, _hidden: unknown, options: CaseDeletionOptions = {}) => {
        calls.push(`purge:${caseId}`)
        options.onProgress?.({ phase: 'purging', done: 10, total: 10 })
      }
    ),
    listPendingDeletions: vi.fn(async () => []),
    ...overrides
  }
  return { lifecycle, calls }
}

describe('CaseDeleteJobRunner', () => {
  it('returns a queued job immediately and completes it in the background', async () => {
    const registry = new BackgroundJobRegistry()
    const { lifecycle, calls } = fakeLifecycle()
    const onSettled = vi.fn()
    const runner = new CaseDeleteJobRunner({ lifecycle, registry, onSettled })

    const job = await runner.start(5, 99)
    expect(job.status).toBe('queued')
    expect(job.subject).toEqual({ type: 'case', id: 5 })

    await runner.idle()
    const finished = registry.get(job.id)
    expect(finished?.status).toBe('succeeded')
    expect(finished?.finishedAt).toBeGreaterThan(0)
    expect(calls).toEqual(['hide:5', 'purge:5'])
    expect(onSettled).toHaveBeenCalledWith(expect.objectContaining({ id: job.id }), 99)
  })

  it('runs deletions serially (one pool connection for purges at a time)', async () => {
    const registry = new BackgroundJobRegistry()
    let active = 0
    let maxActive = 0
    const { lifecycle } = fakeLifecycle({
      completeHiddenDeletion: vi.fn(async () => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active -= 1
      })
    })
    const runner = new CaseDeleteJobRunner({ lifecycle, registry })

    await Promise.all([runner.start(1), runner.start(2), runner.start(3)])
    await runner.idle()
    expect(maxActive).toBe(1)
  })

  it('dedupes a second start for the same case while the first is active', async () => {
    const registry = new BackgroundJobRegistry()
    const { lifecycle } = fakeLifecycle()
    const runner = new CaseDeleteJobRunner({ lifecycle, registry })

    const first = await runner.start(8)
    const second = await runner.start(8)
    expect(second.id).toBe(first.id)
    await runner.idle()
    expect(lifecycle.hideCase).toHaveBeenCalledTimes(1)
  })

  it('rejects missing and importing cases synchronously', async () => {
    const registry = new BackgroundJobRegistry()
    const missing = new CaseDeleteJobRunner({
      lifecycle: fakeLifecycle({ getCaseStatus: vi.fn(async () => undefined) }).lifecycle,
      registry
    })
    await expect(missing.start(1)).rejects.toBeInstanceOf(CaseNotFoundError)

    const importing = new CaseDeleteJobRunner({
      lifecycle: fakeLifecycle({ getCaseStatus: vi.fn(async () => 'importing' as const) })
        .lifecycle,
      registry
    })
    await expect(importing.start(1)).rejects.toBeInstanceOf(InvalidParametersError)
    expect(registry.list()).toHaveLength(0)
  })

  it('marks the job failed with the error message when a phase throws', async () => {
    const registry = new BackgroundJobRegistry()
    const { lifecycle } = fakeLifecycle({
      completeHiddenDeletion: vi.fn(async () => {
        throw new Error('canceling statement due to lock timeout')
      })
    })
    const runner = new CaseDeleteJobRunner({
      lifecycle,
      registry,
      logger: { info: vi.fn(), error: vi.fn() }
    })

    const job = await runner.start(4)
    await runner.idle()
    expect(registry.get(job.id)).toMatchObject({
      status: 'failed',
      error: { code: 'UNKNOWN', message: 'canceling statement due to lock timeout' }
    })
  })

  it('close() aborts between batches and leaves the job resumable', async () => {
    const registry = new BackgroundJobRegistry()
    const { lifecycle } = fakeLifecycle({
      completeHiddenDeletion: vi.fn(
        async (caseId: number, _hidden: unknown, options: CaseDeletionOptions = {}) => {
          await new Promise((resolve) => setTimeout(resolve, 5))
          if (options.signal?.aborted === true) throw new CaseDeletionInterruptedError(caseId)
        }
      )
    })
    const runner = new CaseDeleteJobRunner({
      lifecycle,
      registry,
      logger: { info: vi.fn(), error: vi.fn() }
    })

    const job = await runner.start(6)
    await new Promise((resolve) => setTimeout(resolve, 1))
    await runner.close()
    expect(registry.get(job.id)?.status).toBe('running')
  })

  it('resumePending re-queues cases left in deleting state', async () => {
    const registry = new BackgroundJobRegistry()
    const { lifecycle, calls } = fakeLifecycle({
      listPendingDeletions: vi.fn(async () => [
        { caseId: 11, genomeBuild: 'GRCh38', variantCount: 3 }
      ]),
      hideCase: vi.fn(async () => ({
        state: 'resume' as const,
        genomeBuild: 'GRCh38',
        variantCount: 3
      }))
    })
    const runner = new CaseDeleteJobRunner({
      lifecycle,
      registry,
      logger: { info: vi.fn(), error: vi.fn() }
    })

    const resumed = await runner.resumePending()
    expect(resumed).toHaveLength(1)
    await runner.idle()
    expect(registry.get(resumed[0].id)?.status).toBe('succeeded')
    expect(calls).toEqual(['purge:11'])
  })
})
