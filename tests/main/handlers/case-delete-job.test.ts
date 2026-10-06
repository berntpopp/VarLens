/**
 * Background case-delete job (SQLite): the real delete worker (bundled with
 * esbuild) against a real database, driven through the JobRunner exactly as
 * `cases:startDelete` / `cases:delete*` do.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseService } from '../../../src/main/database/DatabaseService'
import { startSqliteCaseDeleteJob } from '../../../src/main/ipc/handlers/cases-logic'
import { jobRunner } from '../../../src/main/services/jobs/runner'
import type { Job } from '../../../src/shared/types/jobs'
import { bundleWorker } from '../../utils/bundle-worker'

function seed(db: DatabaseService, caseCount: number): void {
  const insertCase = db.database.prepare(
    'INSERT INTO cases (name, file_path, file_size, variant_count, created_at) VALUES (?, ?, 1, 2, 0)'
  )
  const insertVariant = db.database.prepare(
    'INSERT INTO variants (case_id, chr, pos, ref, alt) VALUES (?, ?, ?, ?, ?)'
  )
  for (let i = 1; i <= caseCount; i++) {
    const caseId = Number(insertCase.run(`case-${i}`, `/tmp/case-${i}.json`).lastInsertRowid)
    insertVariant.run(caseId, '1', 100, 'A', 'G') // shared by every case
    insertVariant.run(caseId, '1', 1000 + i, 'C', 'T') // private to this case
    db.variants.updateFrequencies(caseId)
  }
}

function frequencyOf(db: DatabaseService, pos: number): number | null {
  const row = db.database
    .prepare('SELECT case_count FROM variant_frequency WHERE pos = ?')
    .get(pos) as { case_count: number } | undefined
  return row?.case_count ?? null
}

describe('SQLite case delete background job', () => {
  let workerPath: string
  let dir: string
  let db: DatabaseService
  const snapshots: Job[] = []
  let unsubscribe: () => void

  beforeAll(async () => {
    workerPath = await bundleWorker('src/main/workers/delete-worker.ts')
  }, 60_000)

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'varlens-delete-job-'))
    db = new DatabaseService(join(dir, 'test.db'))
    snapshots.length = 0
    unsubscribe = jobRunner.onLifecycle((job) => {
      if (job.kind === 'case_delete') snapshots.push({ ...job, progress: job.progress })
    })
  })

  afterEach(() => {
    unsubscribe()
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('deletes cases in the worker, maintains frequencies there and reports progress', async () => {
    seed(db, 3)
    const events: string[] = []

    const handle = startSqliteCaseDeleteJob(
      { mode: 'ids', ids: [1, 2] },
      () => db,
      {
        onDeleted: ({ deleted }) => events.push(`deleted:${deleted}`),
        onCohortStale: ({ is_stale }) => events.push(`stale:${is_stale}`)
      },
      { workerPath }
    )
    const result = await handle.result

    expect(result).toEqual({ deleted: 2, cancelled: false })
    expect(db.cases.getAllCases().map((c) => c.name)).toEqual(['case-3'])
    expect(frequencyOf(db, 100)).toBe(1)
    expect(frequencyOf(db, 1001)).toBeNull()
    expect(frequencyOf(db, 1003)).toBe(1)
    expect(events).toEqual(['stale:true', 'deleted:2', 'stale:false'])

    const phases = snapshots.map((job) => job.progress?.message).filter(Boolean)
    expect(phases).toContain('deleting')
    expect(phases).toContain('rebuilding-search-index')
    expect(phases).toContain('rebuilding-cohort-summary')
    expect(snapshots.at(-1)?.status).toBe('completed')
    expect(jobRunner.get(handle.id)?.status).toBe('completed')
  })

  it('delete-all clears the frequency table', async () => {
    seed(db, 2)

    const result = await startSqliteCaseDeleteJob({ mode: 'all' }, () => db, {}, { workerPath })
      .result

    expect(result.deleted).toBe(2)
    expect(db.cases.getAllCases()).toEqual([])
    expect(db.database.prepare('SELECT COUNT(*) AS c FROM variant_frequency').get()).toEqual({
      c: 0
    })
  })

  it('is cancellable between cases and ends in the cancelled state', async () => {
    seed(db, 5)

    const handle = startSqliteCaseDeleteJob(
      { mode: 'ids', ids: [1, 2, 3, 4, 5] },
      () => db,
      {},
      { workerPath }
    )
    await jobRunner.cancel(handle.id)
    const failure = await handle.result.then(
      () => null,
      (error: Error) => error
    )

    expect(failure?.name).toBe('AbortError')
    expect(jobRunner.get(handle.id)?.status).toBe('cancelled')
    const remaining = db.cases.getAllCases().length
    expect(remaining).toBeGreaterThan(0)
    expect(remaining).toBeLessThan(5)
    // Every committed delete took its frequency contribution with it.
    expect(frequencyOf(db, 100)).toBe(remaining)
  })

  it('rejects a second concurrent delete (single flight per job kind)', async () => {
    seed(db, 2)
    const first = startSqliteCaseDeleteJob({ mode: 'ids', ids: [1] }, () => db, {}, { workerPath })

    expect(() =>
      startSqliteCaseDeleteJob({ mode: 'ids', ids: [2] }, () => db, {}, { workerPath })
    ).toThrow(/already in progress/)
    await first.result
  })
})
