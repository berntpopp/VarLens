import { describe, expect, it, vi } from 'vitest'

import { InvalidParametersError } from '../../../../src/main/ipc/errors'
import { JobRunner } from '../../../../src/main/services/jobs/JobRunner'
import {
  CaseDeletionInterruptedError,
  type CaseDeletionOptions
} from '../../../../src/main/storage/postgres/PostgresCaseLifecycleRepository'
import type { Job } from '../../../../src/shared/types/jobs'
import {
  type CaseDeletionLifecycle,
  CaseNotFoundError,
  PostgresCaseDeleteJobs
} from '../../../../src/web/server/jobs/case-delete-jobs'

function fakeLifecycle(overrides: Partial<CaseDeletionLifecycle> = {}) {
  const calls: string[] = []
  const lifecycle: CaseDeletionLifecycle = {
    getCaseStatus: vi.fn(async () => 'ready' as const),
    listReadyCaseIds: vi.fn(async () => [1, 2]),
    hideCase: vi.fn(async (caseId: number) => {
      calls.push(`hide:${caseId}`)
      return { state: 'hidden' as const, genomeBuild: 'GRCh38', variantCount: 10 }
    }),
    completeHiddenDeletion: vi.fn(
      async (caseId: number, _hidden: unknown, options: CaseDeletionOptions = {}) => {
        calls.push(`purge:${caseId}`)
        options.onProgress?.({ phase: 'purging', done: 10, total: 10 })
        options.onProgress?.({ phase: 'finalizing', done: 10, total: 10 })
      }
    ),
    listPendingDeletions: vi.fn(async () => []),
    ...overrides
  }
  return { lifecycle, calls }
}

function setup(overrides: Partial<CaseDeletionLifecycle> = {}) {
  const runner = new JobRunner()
  const { lifecycle, calls } = fakeLifecycle(overrides)
  const changes: Array<{ job: Job; owner: number | undefined }> = []
  const jobs = new PostgresCaseDeleteJobs({
    lifecycle,
    runner,
    logger: { info: vi.fn(), error: vi.fn() },
    onJobChanged: (job, owner) => changes.push({ job, owner })
  })
  return { runner, lifecycle, calls, changes, jobs }
}

describe('PostgresCaseDeleteJobs (shared case_delete contract)', () => {
  it('returns a job id at once and completes with {deleted, cancelled}', async () => {
    const { jobs, runner, calls } = setup()

    const handle = jobs.start({ mode: 'ids', ids: [5, 6] }, 42)
    expect(runner.get(handle.id)).toMatchObject({ kind: 'case_delete', status: 'running' })

    await expect(handle.result).resolves.toEqual({ deleted: 2, cancelled: false })
    const job = runner.get(handle.id)!
    expect(job.status).toBe('completed')
    expect(job.params).toEqual({ mode: 'ids', ids: [5, 6] })
    expect(job.progress).toEqual({ current: 2, total: 2, message: 'finalizing' })
    expect(calls).toEqual(['hide:5', 'purge:5', 'hide:6', 'purge:6'])
  })

  it('reports contract phases with case counters and routes snapshots to the owner', async () => {
    const { jobs, changes } = setup()
    await jobs.start({ mode: 'ids', ids: [5] }, 42).result

    const owned = changes.filter((c) => c.owner === 42)
    expect(owned.length).toBeGreaterThan(0)
    const phases = owned.map((c) => c.job.progress?.message).filter(Boolean)
    // PostgreSQL deletion has no cohort-summary rebuild phase: the summary is
    // decremented in the hide step and frequency is derived at read time.
    expect(new Set(phases)).toEqual(new Set(['deleting', 'finalizing']))
    expect(owned.at(-1)?.job.status).toBe('completed')
  })

  it("mode 'all' deletes every ready case", async () => {
    const { jobs, calls } = setup()
    await expect(jobs.start({ mode: 'all' }).result).resolves.toEqual({
      deleted: 2,
      cancelled: false
    })
    expect(calls).toEqual(['hide:1', 'purge:1', 'hide:2', 'purge:2'])
  })

  it('is single-flight like the desktop job', async () => {
    const { jobs } = setup()
    const first = jobs.start({ mode: 'ids', ids: [1] })
    expect(() => jobs.start({ mode: 'ids', ids: [2] })).toThrow('already in progress')
    await first.result
  })

  it('jobs:cancel lands between cases and marks the job cancelled', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const { jobs, runner, calls } = setup({
      completeHiddenDeletion: vi.fn(async (caseId: number) => {
        calls.push(`purge:${caseId}`)
        await gate
      })
    })

    const handle = jobs.start({ mode: 'ids', ids: [1, 2, 3] })
    await vi.waitFor(() => expect(calls).toContain('purge:1'))
    await runner.cancel(handle.id)
    release()

    await expect(handle.result).rejects.toThrow('cancelled after 1')
    expect(runner.get(handle.id)?.status).toBe('cancelled')
    expect(calls).toEqual(['hide:1', 'purge:1'])
  })

  it('a failing case fails the job with a serialized error', async () => {
    const { jobs, runner } = setup({
      hideCase: vi.fn(async () => {
        throw new Error('canceling statement due to lock timeout')
      })
    })
    const handle = jobs.start({ mode: 'ids', ids: [1] })
    await expect(handle.result).rejects.toThrow('lock timeout')
    expect(runner.get(handle.id)).toMatchObject({
      status: 'failed',
      error: { message: 'canceling statement due to lock timeout' }
    })
  })

  it('close() interrupts between purge batches (case resumes at next boot)', async () => {
    const { jobs, runner } = setup({
      completeHiddenDeletion: vi.fn(
        async (caseId: number, _h: unknown, options: CaseDeletionOptions = {}) => {
          await new Promise((r) => setTimeout(r, 5))
          if (options.signal?.aborted === true) throw new CaseDeletionInterruptedError(caseId)
        }
      )
    })
    const handle = jobs.start({ mode: 'ids', ids: [1] })
    await jobs.close()
    expect(runner.get(handle.id)?.status).toBe('failed')
  })

  it('resumePending re-runs hidden cases as a case_delete job', async () => {
    const { jobs, calls } = setup({
      listPendingDeletions: vi.fn(async () => [
        { caseId: 11, genomeBuild: 'GRCh38', variantCount: 3 }
      ]),
      hideCase: vi.fn(async () => ({
        state: 'resume' as const,
        genomeBuild: 'GRCh38',
        variantCount: 3
      }))
    })
    const handle = await jobs.resumePending()
    await expect(handle!.result).resolves.toEqual({ deleted: 1, cancelled: false })
    expect(calls).toEqual(['purge:11'])
  })

  it('assertDeletable rejects missing and importing cases', async () => {
    const missing = setup({ getCaseStatus: vi.fn(async () => undefined) })
    await expect(missing.jobs.assertDeletable(1)).rejects.toBeInstanceOf(CaseNotFoundError)
    const importing = setup({ getCaseStatus: vi.fn(async () => 'importing' as const) })
    await expect(importing.jobs.assertDeletable(1)).rejects.toBeInstanceOf(InvalidParametersError)
  })
})
