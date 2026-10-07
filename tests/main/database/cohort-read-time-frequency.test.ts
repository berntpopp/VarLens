/**
 * SQLite cohort frequency is derived at read time: carriers over the number
 * of cases of the row's genome build. Nothing writes the stored
 * `cohort_variant_summary.cohort_frequency` column, so these tests overwrite
 * it with garbage (or blank it) and assert every reader still shows the right
 * value — after a rebuild, after adding a case and after deleting one.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import * as XLSX from 'xlsx'
import { CohortService } from '../../../src/main/database/cohort'
import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'
import { CohortSummaryService } from '../../../src/main/database/CohortSummaryService'
import { openCaseSummaryRemoval } from '../../../src/main/database/cohort-summary-case-removal'
import { runCohortExport } from '../../../src/main/workers/cohort-export'
import type { CohortSearchParams } from '../../../src/shared/types/cohort'

describe('SQLite cohort frequency is derived at read time', () => {
  let db: Database.Database
  let cohort: CohortService
  let summary: CohortSummaryService
  let dir: string

  const insertCase = (name: string, build: string | null = 'GRCh38'): number =>
    db
      .prepare(
        `INSERT INTO cases (name, file_path, file_size, variant_count, created_at, genome_build)
         VALUES (?, ?, 1, 0, ?, ?)`
      )
      .run(name, `/t/${name}.json`, Date.now(), build).lastInsertRowid as number

  const insertVariant = (caseId: number, pos: number): void => {
    db.prepare(
      "INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, gt_num) VALUES (?, '1', ?, 'A', 'G', 'G1', '0/1')"
    ).run(caseId, pos)
  }

  /** Stored values must not matter: blank them, or make them plainly wrong. */
  const corruptStored = (value: 'NULL' | '0.123'): void => {
    db.exec(`UPDATE cohort_variant_summary SET cohort_frequency = ${value}`)
  }

  const list = (params: CohortSearchParams = {}): Array<[number, string, number | null]> => {
    cohort.invalidateColumnMetaCache()
    return cohort
      .getCohortVariants(params)
      .data.map((v) => [v.pos, v.variant_key, v.cohort_frequency] as [number, string, number])
  }
  const frequencies = (params: CohortSearchParams = {}): Record<number, number | null> =>
    Object.fromEntries(list(params).map(([pos, , frequency]) => [pos, frequency]))
  const positions = (params: CohortSearchParams): number[] => list(params).map(([pos]) => pos)

  const deleteCase = (caseId: number): void => {
    const removal = openCaseSummaryRemoval(db)
    if (removal === null) throw new Error('summary unexpectedly stale')
    db.transaction(() => {
      removal.beforeDelete(caseId)
      db.prepare('DELETE FROM cases WHERE id = ?').run(caseId)
      removal.afterDelete()
    })()
  }

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    initializeSchema(db)
    runMigrations(db)
    cohort = new CohortService(db)
    summary = new CohortSummaryService(db)
    dir = mkdtempSync(join(tmpdir(), 'varlens-cohort-frequency-'))
  })

  afterEach(() => {
    cohort.close()
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  /** Four cases; pos 100 carried by all, 200 by two, 300 by one. */
  function seedFourCases(): number[] {
    const ids = ['a', 'b', 'c', 'd'].map((name) => insertCase(name))
    for (const id of ids) insertVariant(id, 100)
    insertVariant(ids[0], 200)
    insertVariant(ids[1], 200)
    insertVariant(ids[0], 300)
    summary.rebuild()
    return ids
  }

  it('nothing stores the frequency: rebuild, incremental add/remove and case removal leave it NULL', () => {
    const ids = seedFourCases()
    const stored = (): number =>
      (
        db
          .prepare(
            'SELECT COUNT(*) AS n FROM cohort_variant_summary WHERE cohort_frequency IS NOT NULL'
          )
          .get() as { n: number }
      ).n
    expect(stored()).toBe(0)

    const extra = insertCase('e')
    insertVariant(extra, 100)
    insertVariant(extra, 400)
    summary.incrementalAdd(extra)
    expect(stored()).toBe(0)
    expect(frequencies()).toEqual({ 100: 1, 200: 0.4, 300: 0.2, 400: 0.2 })

    summary.incrementalRemove(extra)
    expect(stored()).toBe(0)
    db.prepare('DELETE FROM cases WHERE id = ?').run(extra)
    summary.rebuild()
    deleteCase(ids[3])
    expect(stored()).toBe(0)
  })

  it.each(['NULL', '0.123'] as const)(
    'lists, sorts, filters and exports the right frequency with the stored column = %s',
    (garbage) => {
      const ids = seedFourCases()
      corruptStored(garbage)
      expect(frequencies()).toEqual({ 100: 1, 200: 0.5, 300: 0.25 })

      // Adding a case changes every denominator — with no summary rewrite.
      const extra = insertCase('e')
      insertVariant(extra, 300)
      summary.incrementalAdd(extra)
      corruptStored(garbage)
      expect(frequencies()).toEqual({ 100: 0.8, 200: 0.4, 300: 0.4 })
      summary.rebuild() // incrementalAdd leaves the gene burden stale

      // Deleting a case: carrier counts are patched, the frequency is derived.
      deleteCase(extra)
      deleteCase(ids[3])
      corruptStored(garbage)
      expect(frequencies()).toEqual({ 100: 1, 200: 2 / 3, 300: 1 / 3 })

      // Sort (multi-build expression and the single-build carrier shortcut).
      expect(positions({ sort_by: 'cohort_frequency', sort_order: 'asc' })).toEqual([300, 200, 100])
      expect(positions({ sort_by: 'cohort_frequency', sort_order: 'desc' })).toEqual([
        100, 200, 300
      ])
      expect(
        positions({ sort_by: 'cohort_frequency', sort_order: 'asc', genome_build: 'GRCh38' })
      ).toEqual([300, 200, 100])

      // Filters: max_internal_af, and a typed column filter (number and text value).
      expect(positions({ max_internal_af: 0.5 })).toEqual([300])
      expect(cohort.getCohortVariants({ max_internal_af: 0.7 }).total_count).toBe(2)
      for (const value of [0.5, '0.5']) {
        const params: CohortSearchParams = {
          column_filters: { cohort_frequency: { operator: '>=', value } }
        }
        expect(positions(params)).toEqual([100, 200])
        expect(cohort.getCohortVariants(params).total_count).toBe(2)
      }

      // Column metadata (min / max / distinct values) reads the derived value.
      const meta = cohort.getColumnMeta().find((m) => m.key === 'cohort_frequency')
      expect(meta).toMatchObject({ dataType: 'numeric', distinctCount: 3, min: 1 / 3, max: 1 })
      expect(meta?.distinctValues?.map(Number).sort()).toEqual([1 / 3, 2 / 3, 1])

      // Export takes its rows from the same reader.
      const file = join(dir, 'cohort.xlsx')
      runCohortExport(db, { sort_by: 'cohort_frequency', sort_order: 'desc' }, file, () => {})
      const book = XLSX.read(readFileSync(file))
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets['Cohort Variants'])
      expect(rows.map((row) => row['Cohort Frequency'])).toEqual(['100.0%', '66.7%', '33.3%'])
    }
  )

  it('uses a per-genome-build denominator', () => {
    const [h1, h2, h3] = ['h1', 'h2', 'h3'].map((name) => insertCase(name, 'GRCh38'))
    const g1 = insertCase('g1', 'GRCh37')
    for (const id of [h1, h2, h3, g1]) insertVariant(id, 100)
    insertVariant(h1, 200)
    summary.rebuild()
    corruptStored('0.123')

    const byBuild = (build: string): Record<number, number | null> =>
      frequencies({ genome_build: build })
    expect(byBuild('GRCh38')).toEqual({ 100: 1, 200: 1 / 3 })
    // One GRCh37 case carrying the variant is 1/1, not 1/4.
    expect(byBuild('GRCh37')).toEqual({ 100: 1 })

    // Across builds the sort is by frequency, not by carrier count:
    // GRCh37 pos 100 (1 carrier, 1.0) ranks above GRCh38 pos 200 (1 carrier, 0.33).
    const sorted = cohort.getCohortVariants({ sort_by: 'cohort_frequency', sort_order: 'asc' })
    expect(sorted.data.map((v) => v.cohort_frequency)).toEqual([1 / 3, 1, 1])

    // Deleting a GRCh38 case changes only the GRCh38 denominator.
    deleteCase(h3)
    corruptStored('0.123')
    expect(byBuild('GRCh38')).toEqual({ 100: 1, 200: 0.5 })
    expect(byBuild('GRCh37')).toEqual({ 100: 1 })
  })

  it('max_internal_af: 0 means off, and a row without a frequency is kept', () => {
    seedFourCases()
    // A summary row whose build has no cases has no denominator → NULL frequency.
    db.exec(`
      INSERT INTO cohort_variant_summary
        (chr, pos, ref, alt, carrier_count, het_count, hom_count, variant_key, variant_type, genome_build)
      VALUES ('1', 900, 'A', 'G', 1, 1, 0, '1:900:A:G', 'snv', 'T2T')
    `)
    corruptStored('0.123')
    expect(frequencies()[900]).toBeNull()

    expect(positions({ max_internal_af: 0 }).sort()).toEqual([100, 200, 300, 900])
    expect(cohort.getCohortVariants({ max_internal_af: 0 }).total_count).toBe(4)
    expect(positions({ max_internal_af: 0.3 }).sort()).toEqual([300, 900])
    expect(cohort.getCohortVariants({ max_internal_af: 0.3 }).total_count).toBe(2)
  })

  it('the default carrier-count count query does not join the build totals', () => {
    seedFourCases()
    const prepared: string[] = []
    const prepare = db.prepare.bind(db)
    db.prepare = ((sql: string) => {
      prepared.push(sql)
      return prepare(sql)
    }) as typeof db.prepare
    cohort.getCohortVariants({})
    cohort.getCohortVariants({ max_internal_af: 0.5 })
    const counts = prepared.filter((sql) =>
      /COUNT\(\*\) as count\s+FROM cohort_variant_summary/.test(sql)
    )
    expect(counts).toHaveLength(2)
    expect(counts[0]).not.toContain('bt')
    expect(counts[1]).toContain('bt.total')
  })
})
