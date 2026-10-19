// @vitest-environment node
/**
 * A cohort export must not write a file from a stale cohort summary (#469
 * review, item 3): the file would carry outdated values and no hint.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import Database from 'better-sqlite3-multiple-ciphers'
import { DatabaseService } from '../../../src/main/database'
import { CohortService } from '../../../src/main/database/cohort'
import { exportCohort } from '../../../src/main/ipc/handlers/export-logic'
import { runCohortExport } from '../../../src/main/workers/cohort-export'
import { CohortSummaryRefreshingError } from '../../../src/shared/errors/cohort-summary-refreshing'
import { MARK_STALE_SQL } from '../../../src/shared/sql/cohort-summary-rebuild'

describe('SQLite cohort export while the summary is stale', () => {
  let dir: string
  let service: DatabaseService
  let caseId: number

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'varlens-cohort-export-stale-'))
    service = new DatabaseService(join(dir, 'test.db'))
    caseId = service.cases.createCase('one', '/tmp/one.json', 0, 'GRCh38')
    service.variants.insertVariantsBatch(caseId, [
      { chr: '1', pos: 100, ref: 'A', alt: 'T', gt_num: '0/1', consequence: 'HIGH' } as never
    ])
    service.cohortSummary.rebuild()
  })

  afterEach(() => {
    service.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('the worker writes the file from a current summary', async () => {
    const file = join(dir, 'current.xlsx')
    expect(await runCohortExport(service.database, {}, file, () => undefined)).toMatchObject({
      rowCount: 1
    })
    expect(existsSync(file)).toBe(true)
  })

  it('the worker refuses a stale summary and writes nothing', async () => {
    service.database.exec(MARK_STALE_SQL)
    const file = join(dir, 'stale.xlsx')
    await expect(runCohortExport(service.database, {}, file, () => undefined)).rejects.toThrow(
      CohortSummaryRefreshingError
    )
    expect(existsSync(file)).toBe(false)
  })

  it('the export fails with the typed error after the bounded wait, without starting a job', async () => {
    service.database.exec(MARK_STALE_SQL)
    const file = join(dir, 'stale.xlsx')
    const started = Date.now()
    await expect(
      exportCohort(() => service, {}, file, {}, { refreshWaitMs: 60 })
    ).rejects.toBeInstanceOf(CohortSummaryRefreshingError)
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(existsSync(file)).toBe(false)
  })

  it('holds a read snapshot so concurrent delete on another connection does not alter export', async () => {
    service.database.transaction(() => {
      const stmt = service.database.prepare(
        'INSERT INTO variants (case_id, chr, pos, ref, alt, gt_num, consequence) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      for (let i = 1; i <= 5004; i++) {
        stmt.run(caseId, '1', 1000 + i, 'A', 'T', '0/1', 'HIGH')
      }
    })()
    service.cohortSummary.rebuild()

    const file = join(dir, 'snapshot.xlsx')
    const db2 = new Database(join(dir, 'test.db'))
    try {
      let deleted = false
      const result = await runCohortExport(service.database, {}, file, (current) => {
        if (!deleted && current === 1000) {
          deleted = true
          db2.prepare('DELETE FROM cohort_variant_summary').run()
        }
      })
      expect(deleted).toBe(true)
      expect(result.rowCount).toBe(5005)
      expect(existsSync(file)).toBe(true)

      const remainingOnDb2 = db2
        .prepare('SELECT count(*) as count FROM cohort_variant_summary')
        .get() as { count: number }
      expect(remainingOnDb2.count).toBe(0)
    } finally {
      db2.close()
    }
  })

  it('strips cursor from search params so multi-page cohort export does not loop on page 1', async () => {
    service.database.transaction(() => {
      const stmt = service.database.prepare(
        'INSERT INTO variants (case_id, chr, pos, ref, alt, gt_num, consequence) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      for (let i = 1; i <= 5004; i++) {
        stmt.run(caseId, '1', 1000 + i, 'A', 'T', '0/1', 'HIGH')
      }
    })()
    service.cohortSummary.rebuild()

    const file = join(dir, 'cursor-export.xlsx')
    const cohortService = new CohortService(service.database)
    const page1 = cohortService.getCohortVariants({ limit: 1 })
    expect(page1.next_cursor).toBeTruthy()

    const result = await runCohortExport(
      service.database,
      { cursor: page1.next_cursor!, _count_needed: true } as never,
      file,
      () => undefined
    )
    expect(result.rowCount).toBe(5005)
    expect(existsSync(file)).toBe(true)
  })
})
