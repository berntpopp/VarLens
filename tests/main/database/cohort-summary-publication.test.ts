/**
 * Publication of an imported case (`cases.import_status`, migration v40): a
 * case is inserted 'provisional' and readers only see 'ready' cases. Whatever
 * the summary upkeep does — merge, skip by policy, fail — `addCase` leaves the
 * case ready, and a ready case missing from the summary always comes with the
 * stale flag. Only a publication that itself fails leaves the case provisional,
 * and says so by throwing.
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

/** Breaks the per-case merge (and every full rebuild) at the gene-burden upsert. */
const BREAK_MERGE = `
  CREATE TRIGGER break_merge BEFORE INSERT ON gene_burden_summary
  BEGIN SELECT RAISE(ABORT, 'merge broken for this test'); END`

/** Breaks the flip to 'ready' itself. */
const BREAK_PUBLICATION = `
  CREATE TRIGGER break_publication BEFORE UPDATE OF import_status ON cases
  BEGIN SELECT RAISE(ABORT, 'publication broken for this test'); END`

describe('import summary session: publication of the imported case', () => {
  let service: DatabaseService
  let warnings: string[]
  let staleNotices: number

  const db = (): DatabaseService['database'] => service.database

  beforeEach(() => {
    service = new DatabaseService(':memory:')
    warnings = []
    staleNotices = 0
  })

  afterEach(() => {
    service.close()
  })

  /** A committed, not yet published case, as the import pipeline leaves it. */
  function importCase(name: string, firstPos: number, rows: number): number {
    const id = Number(
      db()
        .prepare(
          `INSERT INTO cases
             (name, file_path, file_size, variant_count, created_at, genome_build, import_status)
           VALUES (?, '/tmp/x.json', 1, ?, 0, 'GRCh38', 'provisional')`
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

  function openSession(
    overrides: Partial<Parameters<typeof openImportSummarySession>[1]> = {}
  ): ImportSummarySession {
    return openImportSummarySession(db(), {
      forceRebuild: false,
      rebuild: () => rebuildCohortSummary(db()),
      onWarning: (warning) => warnings.push(warning),
      onStale: () => staleNotices++,
      ...overrides
    })
  }

  const statusOf = (caseId: number): string | undefined =>
    (
      db().prepare('SELECT import_status FROM cases WHERE id = ?').get(caseId) as
        { import_status: string } | undefined
    )?.import_status

  const isExactNow = (): boolean =>
    JSON.stringify(snapshotSummary(db())) === JSON.stringify(referenceSummary(db()))

  it('publishes the case in the transaction that merges it', () => {
    const session = openSession()
    const id = importCase('A', 100, 5)
    expect(statusOf(id)).toBe('provisional')

    session.addCase(id)

    expect(statusOf(id)).toBe('ready')
    expect(isCohortSummaryStale(db())).toBe(false)
    expect(isExactNow()).toBe(true)
    expect(staleNotices).toBe(0)
  })

  it('publishes the case with the stale flag when the merge throws', () => {
    const session = openSession()
    session.addCase(importCase('A', 100, 5))
    db().exec(BREAK_MERGE)
    const id = importCase('B', 103, 5)

    session.addCase(id)

    // Not stuck provisional: hidden from every reader, its name taken for good.
    expect(statusOf(id)).toBe('ready')
    expect(isCohortSummaryStale(db())).toBe(true)
    expect(session.isExact()).toBe(false)
    expect(warnings).toHaveLength(1)
    expect(staleNotices).toBe(1)

    db().exec('DROP TRIGGER break_merge')
    session.finish()
    expect(isCohortSummaryStale(db())).toBe(false)
    expect(isExactNow()).toBe(true)
  })

  it('publishes the case with the stale flag when one rebuild is cheaper than merging', () => {
    for (let c = 0; c < 2; c++) importCase(`old-${c}`, 100, 40)
    db().exec("UPDATE cases SET import_status = 'ready'")
    rebuildCohortSummary(db())
    const session = openSession({ upkeepPolicy: { ...DEFAULT_UPKEEP_POLICY, minSummaryRows: 10 } })
    const id = importCase('new', 120, 40)

    // 21 files left x 60 summary rows > 3 x 120 variants: rebuild once.
    session.addCase(id, 20)

    expect(statusOf(id)).toBe('ready')
    expect(isCohortSummaryStale(db())).toBe(true)
    expect(warnings).toEqual([])
    session.finish()
    expect(isExactNow()).toBe(true)
  })

  it('publishes the case with the stale flag when upkeep was abandoned at session start', () => {
    const session = openSession({
      forceRebuild: true,
      rebuild: () => {
        throw new Error('rebuild broken for this test')
      }
    })
    expect(session.isExact()).toBe(false)
    const id = importCase('A', 100, 5)

    session.addCase(id)

    expect(statusOf(id)).toBe('ready')
    expect(isCohortSummaryStale(db())).toBe(true)
  })

  it('publishes the case in a database without summary tables', () => {
    db().exec('DROP TABLE cohort_variant_summary')
    db().exec('DROP TABLE gene_burden_summary')
    const session = openSession()
    const id = importCase('A', 100, 5)

    session.addCase(id)

    expect(statusOf(id)).toBe('ready')
  })

  it('throws, with the case provisional and the summary untouched, when publication fails', () => {
    const session = openSession()
    session.addCase(importCase('A', 100, 5))
    const before = snapshotSummary(db())
    db().exec(BREAK_PUBLICATION)
    const id = importCase('B', 103, 5)

    // The caller must hear about it: it deletes the case and fails the file.
    expect(() => session.addCase(id)).toThrow(/publication broken/)

    expect(statusOf(id)).toBe('provisional')
    // The merge was rolled back with the failed flip: B is in no summary row.
    expect(snapshotSummary(db())).toEqual(before)
  })

  it('nests in a caller transaction that is rolled back as a whole', () => {
    const session = openSession()
    session.addCase(importCase('A', 100, 5))
    const before = snapshotSummary(db())
    const id = importCase('B', 103, 5)

    expect(() =>
      db()
        .transaction(() => {
          session.addCase(id)
          throw new Error('caller failed after publishing')
        })
        .immediate()
    ).toThrow(/caller failed/)

    expect(statusOf(id)).toBe('provisional')
    expect(snapshotSummary(db())).toEqual(before)
    expect(isCohortSummaryStale(db())).toBe(false)
  })
})
