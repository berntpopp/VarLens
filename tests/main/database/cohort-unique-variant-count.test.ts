// @vitest-environment node
/**
 * Issue #460: the cohort tile's unique-variant number is the count of distinct
 * (chr, pos, ref, alt), served from an exact maintained counter. Fixture per
 * the issue: duplicate rows in a case, two genome builds and two variant types
 * for one coordinate — where COUNT(*) of the summary over-counts.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'

import { DatabaseService } from '../../../src/main/database'
import { openImportSummarySession } from '../../../src/main/database/cohort-summary-case-add'
import { openCaseSummaryRemoval } from '../../../src/main/database/cohort-summary-case-removal'
import { readUniqueVariantCount } from '../../../src/main/database/cohort-unique-variant-count'
import { initializeSchema } from '../../../src/main/database/schema'
import { LATEST_SQLITE_SCHEMA_VERSION, runMigrations } from '../../../src/main/database/migrations'
import { deleteCasesIncrementally } from '../../../src/main/workers/delete-operations'
import { rebuildCohortSummary } from '../../../src/main/workers/worker-db'
import { MARK_STALE_SQL } from '../../../src/shared/sql/cohort-summary-rebuild'
import {
  referenceSummary,
  snapshotSummary,
  summaryMeta
} from '../workers/support/summary-reference'

type Row = [pos: number, type?: string, alt?: string]

describe('exact unique-variant counter (#460)', () => {
  let service: DatabaseService
  const db = (): DatabaseService['database'] => service.database

  function addCase(name: string, build: string, rows: Row[]): number {
    const id = Number(
      db()
        .prepare(
          `INSERT INTO cases (name, file_path, file_size, variant_count, created_at, genome_build)
           VALUES (?, '/tmp/x.json', 1, 0, 0, ?)`
        )
        .run(name, build).lastInsertRowid
    )
    const insert = db().prepare(
      `INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, gt_num, variant_type)
       VALUES (?, 'chr1', ?, 'A', ?, 'GENE', '0/1', ?)`
    )
    for (const [pos, type = 'snv', alt = 'G'] of rows) insert.run(id, pos, alt, type)
    return id
  }

  const A: Row[] = [[100], [100], [200], [300, 'snv'], [300, 'sv']] // duplicate row, two types
  const B: Row[] = [[100], [300, 'sv'], [400], [400, 'cnv']]
  const C37: Row[] = [[100], [500], [200, 'snv', 'T']] // other build, other allele

  const tile = (): number => service.cohort.getCohortSummary().unique_variants
  const summaryRows = (): number =>
    (db().prepare('SELECT COUNT(*) AS c FROM cohort_variant_summary').get() as { c: number }).c
  const expectExact = (): void => expect(snapshotSummary(db())).toEqual(referenceSummary(db()))

  const session = (): ReturnType<typeof openImportSummarySession> =>
    openImportSummarySession(db(), {
      forceRebuild: false,
      rebuild: () => rebuildCohortSummary(db()),
      onWarning: (warning) => {
        throw new Error(warning)
      }
    })

  async function remove(caseId: number): Promise<void> {
    await deleteCasesIncrementally(db(), [caseId], {
      deletingAll: false,
      isCancelled: () => false,
      onProgress: () => undefined,
      summary: openCaseSummaryRemoval(db())
    })
  }

  beforeEach(() => {
    service = new DatabaseService(':memory:')
  })

  afterEach(() => service.close())

  it('a rebuild counts coordinates, not summary rows', () => {
    addCase('a', 'GRCh38', A)
    addCase('c', 'GRCh37', C37)
    service.cohortSummary.rebuild()

    expect(summaryRows()).toBe(7) // 100 x2 builds, 200/G, 200/T, 300 x2 types, 500
    expect(tile()).toBe(5)
    expect(summaryMeta(db(), 'unique_variant_count')).toBe('5')
    expectExact()
  })

  it('stays exact through per-file adds and incremental removals in any order', async () => {
    const upkeep = session()
    expect(tile()).toBe(0)
    const a = addCase('a', 'GRCh38', A)
    upkeep.addCase(a)
    expect(tile()).toBe(3)
    expectExact()
    const b = addCase('b', 'GRCh38', B)
    upkeep.addCase(b)
    expect(tile()).toBe(4)
    expectExact()
    const c = addCase('c', 'GRCh37', C37)
    upkeep.addCase(c)
    expect(tile()).toBe(6)
    expectExact()
    upkeep.finish()
    expect(upkeep.isExact()).toBe(true)

    await remove(a) // 200/G goes; 100 and 300 keep other rows
    expect(tile()).toBe(5)
    expectExact()
    await remove(c) // 500 and 200/T go; 100 keeps its GRCh38 row
    expect(tile()).toBe(3)
    expectExact()
    await remove(b)
    expect(tile()).toBe(0)
    expect(summaryMeta(db(), 'unique_variant_count')).toBe('0')
    expectExact()
  })

  it('an import overwrite removes the old case’s coordinates', () => {
    const upkeep = session()
    const a = addCase('a', 'GRCh38', A)
    upkeep.addCase(a)
    const b = addCase('b', 'GRCh38', B)
    upkeep.addCase(b)
    upkeep.replaceCase(a, () => db().prepare('DELETE FROM cases WHERE id = ?').run(a))
    expect(tile()).toBe(3) // 100, 300, 400
    expectExact()
    upkeep.finish()
  })

  it('counts directly while the summary is stale or the counter is missing', () => {
    addCase('a', 'GRCh38', A)
    service.cohortSummary.rebuild()
    db().exec("UPDATE cohort_summary_meta SET value = '999' WHERE key = 'unique_variant_count'")
    expect(tile()).toBe(999) // served from the counter, no scan
    db().exec(MARK_STALE_SQL)
    expect(tile()).toBe(3)
    db().exec("DELETE FROM cohort_summary_meta WHERE key IN ('unique_variant_count', 'is_stale')")
    expect(readUniqueVariantCount(db())).toBe(3)
  })

  it('migration v39 fills the counter of an existing database', () => {
    const raw = new Database(':memory:')
    try {
      initializeSchema(raw)
      runMigrations(raw)
      raw.exec(`
        INSERT INTO cases (id, name, file_path, file_size, created_at, genome_build)
          VALUES (1, 'a', '/a', 1, 0, 'GRCh38'), (2, 'b', '/b', 1, 0, 'GRCh37');
        INSERT INTO variants (case_id, chr, pos, ref, alt, gt_num, variant_type)
          VALUES (1, 'chr1', 100, 'A', 'G', '0/1', 'snv'), (2, 'chr1', 100, 'A', 'G', '0/1', 'snv'),
                 (1, 'chr1', 200, 'A', 'G', '0/1', 'snv');
      `)
      rebuildCohortSummary(raw)
      raw.exec("DELETE FROM cohort_summary_meta WHERE key = 'unique_variant_count'")
      raw.pragma('user_version = 38')

      runMigrations(raw)

      expect(raw.pragma('user_version', { simple: true })).toBe(LATEST_SQLITE_SCHEMA_VERSION)
      expect(summaryMeta(raw, 'unique_variant_count')).toBe('2')
    } finally {
      raw.close()
    }
  })
})
