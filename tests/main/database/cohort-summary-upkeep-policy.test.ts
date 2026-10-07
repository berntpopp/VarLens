/**
 * An import session merges each file into the cohort summary only while that
 * is cheaper than one rebuild at its end (UpkeepPolicy); either way the
 * summary equals the full rebuild once the session has finished.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DatabaseService } from '../../../src/main/database'
import {
  DEFAULT_UPKEEP_POLICY,
  openImportSummarySession,
  type ImportSummarySession
} from '../../../src/main/database/cohort-summary-case-add'
import { isCohortSummaryStale } from '../../../src/main/database/cohort-summary-case-removal'
import { rebuildCohortSummary } from '../../../src/main/workers/worker-db'
import { referenceSummary, snapshotSummary } from '../workers/support/summary-reference'

describe('import summary session: merge per file or rebuild once', () => {
  let service: DatabaseService
  let rebuilds: number
  let warnings: string[]

  const db = (): DatabaseService['database'] => service.database

  beforeEach(() => {
    service = new DatabaseService(':memory:')
    rebuilds = 0
    warnings = []
  })

  afterEach(() => {
    service.close()
  })

  /** A committed case with `rows` variants at positions `firstPos`, `firstPos + 1`, … */
  function importCase(name: string, firstPos: number, rows: number): number {
    const id = Number(
      db()
        .prepare(
          `INSERT INTO cases (name, file_path, file_size, variant_count, created_at, genome_build)
           VALUES (?, '/tmp/x.json', 1, ?, 0, 'GRCh38')`
        )
        .run(name, rows).lastInsertRowid
    )
    const insert = db().prepare(
      `INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, gt_num, variant_type)
       VALUES (?, '1', ?, 'A', 'G', ?, '0/1', 'snv')`
    )
    for (let i = 0; i < rows; i++) insert.run(id, firstPos + i, `GENE${(firstPos + i) % 7}`)
    return id
  }

  /** Opens a session; `rebuilds` then counts only what happens after its start. */
  function openSession(minSummaryRows: number): ImportSummarySession {
    const session = openImportSummarySession(db(), {
      forceRebuild: false,
      upkeepPolicy: { ...DEFAULT_UPKEEP_POLICY, minSummaryRows },
      rebuild: () => {
        rebuilds++
        rebuildCohortSummary(db())
      },
      onWarning: (warning) => warnings.push(warning)
    })
    rebuilds = 0
    return session
  }

  const isExactNow = (): boolean =>
    JSON.stringify(snapshotSummary(db())) === JSON.stringify(referenceSummary(db()))

  it('keeps merging a few files into a large cohort', () => {
    for (let c = 0; c < 10; c++) importCase(`old-${c}`, 100, 40)
    rebuildCohortSummary(db())
    const session = openSession(10)

    // 3 files left x 40 summary rows <= 3 x 440 variants: merging is cheaper.
    for (let f = 0; f < 3; f++) {
      session.addCase(importCase(`new-${f}`, 120 + f, 40), 2 - f)
      expect(session.isExact()).toBe(true)
      expect(isCohortSummaryStale(db())).toBe(false)
      expect(isExactNow()).toBe(true)
    }
    session.finish()
    expect(rebuilds).toBe(0)
    expect(warnings).toEqual([])
  })

  it('falls back to one rebuild at the end for a long batch into a small cohort', () => {
    const session = openSession(10)

    // First file: the summary is still empty, far below the floor.
    session.addCase(importCase('f-0', 100, 40), 19)
    expect(session.isExact()).toBe(true)
    expect(isExactNow()).toBe(true)

    // 19 files left x 40 summary rows > 3 x 80 variants: rebuilding is cheaper.
    session.addCase(importCase('f-1', 1000, 40), 18)
    expect(session.isExact()).toBe(false)
    expect(isCohortSummaryStale(db())).toBe(true)
    expect(rebuilds).toBe(0)

    // Once deferred, the session stays deferred — even for its last file.
    session.addCase(importCase('f-2', 2000, 40), 0)
    expect(session.isExact()).toBe(false)

    session.finish()
    expect(rebuilds).toBe(1)
    expect(isCohortSummaryStale(db())).toBe(false)
    expect(isExactNow()).toBe(true)
    expect(warnings).toEqual([])
  })

  it('always merges while the summary is below the floor', () => {
    const session = openSession(DEFAULT_UPKEEP_POLICY.minSummaryRows)
    for (let f = 0; f < 5; f++) {
      session.addCase(importCase(`f-${f}`, 100 + f * 1000, 40), 99)
      expect(session.isExact()).toBe(true)
      expect(isExactNow()).toBe(true)
    }
    session.finish()
    expect(rebuilds).toBe(0)
  })
})
