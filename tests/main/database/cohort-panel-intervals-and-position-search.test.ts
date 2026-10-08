/**
 * Large gene panels (#491) and `chr`-prefixed position search (#492) on SQLite.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DatabaseService, type Variant } from '../../../src/main/database'
import { COHORT_PANEL_INTERVAL_CONDITION } from '../../../src/main/database/cohort'

const variant = (chr: string, pos: number, extra: object = {}): Omit<Variant, 'id' | 'case_id'> =>
  ({ chr, pos, ref: 'A', alt: 'T', gt_num: '0/1', ...extra }) as unknown as Omit<
    Variant,
    'id' | 'case_id'
  >

/** 1100 disjoint 100 bp regions on chr 1; only the last one holds a variant. */
const intervals = Array.from({ length: 1100 }, (_, i) => ({
  chr: '1',
  start: 1_000_000 + i * 1000,
  end: 1_000_100 + i * 1000
}))
const IN_PANEL = 1_000_050 + 1099 * 1000

describe('SQLite cohort + export: large panels and position search', () => {
  let sqlite: DatabaseService
  let caseId: number

  beforeEach(() => {
    sqlite = new DatabaseService(':memory:')
    caseId = sqlite.cases.createCase('a', '/tmp/a.json', 0, 'GRCh38')
    sqlite.variants.insertVariantsBatch(caseId, [
      variant('1', IN_PANEL),
      variant('1', 500),
      // A spanning SV that starts before the last region but covers it.
      variant('1', IN_PANEL - 5000, { alt: '<DEL>', end_pos: IN_PANEL + 5000 }),
      variant('2', IN_PANEL),
      variant('chr3', 777)
    ])
    sqlite.cohortSummary.rebuild()
  })

  afterEach(() => sqlite.close())

  it('filters the cohort view by a 1100-region panel', () => {
    const result = sqlite.cohort.getCohortVariants({ panel_intervals: intervals })
    expect(result.data.map((r) => `${r.chr}:${r.pos}`).sort()).toEqual(
      [`1:${IN_PANEL}`, `1:${IN_PANEL - 5000}`].sort()
    )
    expect(result.total_count).toBe(2)
  })

  it('compiles a runnable export query for a 1100-region panel', () => {
    const { sql, parameters } = sqlite.variants.compileExportQuery(
      { case_id: caseId, panel_intervals: intervals },
      100
    )
    const rows = sqlite.database.prepare(sql).all(...(parameters as unknown[])) as Variant[]
    expect(rows.map((r) => r.pos).sort()).toEqual([IN_PANEL - 5000, IN_PANEL])
  })

  it('seeks each region with both bounds, never half a chromosome', () => {
    const plan = (sql: string, parameters: readonly unknown[]): string =>
      (
        sqlite.database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...parameters) as Array<{
          detail: string
        }>
      )
        .map((p) => p.detail)
        .join(' | ')
    const compiled = sqlite.variants.compileExportQuery(
      { case_id: caseId, panel_intervals: intervals },
      100
    )
    const exportPlan = plan(compiled.sql, compiled.parameters)
    expect(exportPlan).toMatch(
      /SCAN iv \| SEARCH pv USING (COVERING )?INDEX \S+ \(case_id=\? AND chr=\? AND pos>\? AND pos<\?\)/
    )
    // Spanning rows: one pass over the case, not one walk per region.
    expect(exportPlan).toMatch(/UNION ALL \| SEARCH pv USING INDEX \S+ \(case_id=\?\)/)
    expect(exportPlan).not.toMatch(/chr=\? AND pos<\?\)/)

    const cohortPlan = plan(
      `SELECT 1 FROM cohort_variant_summary cvs WHERE ${COHORT_PANEL_INTERVAL_CONDITION}`,
      ['[]']
    )
    expect(cohortPlan).toMatch(
      /SCAN iv \| SEARCH pv USING (COVERING )?INDEX \S+ \(chr=\? AND pos>\? AND pos<\?\)/
    )
    expect(cohortPlan).toMatch(
      /SCAN iv \| SEARCH pv USING INDEX idx_cvs_end_pos \(chr=\? AND end_pos>\?\)/
    )
    expect(cohortPlan).not.toMatch(/chr=\? AND pos<\?\)/)
  })

  it.each(['chr3:777', '3:777', 'CHR3:777'])('finds a chr-prefixed variant by %s', (term) => {
    const result = sqlite.cohort.getCohortVariants({ search_term: term })
    expect(result.data.map((r) => `${r.chr}:${r.pos}`)).toEqual(['chr3:777'])
  })

  it.each(['chr2:' + IN_PANEL, '2:' + IN_PANEL])('finds a bare-named variant by %s', (term) => {
    const result = sqlite.cohort.getCohortVariants({ search_term: term })
    expect(result.data.map((r) => `${r.chr}:${r.pos}`)).toEqual([`2:${IN_PANEL}`])
  })

  it('finds a chr-prefixed variant inside a boolean search', () => {
    const result = sqlite.cohort.getCohortVariants({ search_term: '3:777 OR NOSUCHGENE' })
    expect(result.data.map((r) => `${r.chr}:${r.pos}`)).toEqual(['chr3:777'])
  })
})

/**
 * The two-branch region filter must select exactly the rows of the plain
 * overlap predicate `chr = c AND pos <= end AND COALESCE(end_pos, pos) >= start`.
 */
describe('SQLite cohort + export: region filter equals the overlap predicate', () => {
  const OVERLAP = (table: string, scope: string): string =>
    `SELECT pv.rowid FROM json_each(?) iv CROSS JOIN ${table} pv WHERE ${scope} pv.chr = iv.value ->> 'chr' AND pv.pos <= iv.value ->> 'end' AND COALESCE(pv.end_pos, pv.pos) >= iv.value ->> 'start'`

  let seed = 7
  const below = (n: number): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return Math.floor((seed / 4294967296) * n)
  }
  const CHRS = ['1', '2', 'chr3', 'X']
  /** Every row kind: point, spanning, zero-length span, and an end before the start. */
  const rows = (count: number, tag: string): Array<Omit<Variant, 'id' | 'case_id'>> =>
    Array.from({ length: count }, (_, i) => {
      const pos = 1 + below(2000)
      const kind = below(10)
      const end_pos =
        kind < 5 ? null : kind < 8 ? pos + below(400) : kind === 8 ? pos : pos - 1 - below(300)
      return variant(CHRS[below(4)], pos, { alt: `${tag}${i}`, end_pos })
    })

  let sqlite: DatabaseService
  let caseId: number

  beforeEach(() => {
    seed = 7
    sqlite = new DatabaseService(':memory:')
    caseId = sqlite.cases.createCase('a', '/tmp/a.vcf', 0, 'GRCh38')
    sqlite.variants.insertVariantsBatch(caseId, [
      ...rows(1500, 'A'),
      // Inside [950, 1050] by position, but its span ends before the region.
      variant('1', 1000, { alt: 'ENDS_BEFORE', end_pos: 900 }),
      // Exactly on the boundaries of [950, 1050].
      variant('1', 950, { alt: 'ON_START' }),
      variant('1', 1050, { alt: 'ON_END' }),
      variant('1', 1051, { alt: 'PAST_END' }),
      variant('1', 900, { alt: 'TOUCHES_START', end_pos: 950 }),
      variant('1', 900, { alt: 'STOPS_SHORT', end_pos: 949 })
    ])
    // Another case's rows must not leak into the export.
    const other = sqlite.cases.createCase('b', '/tmp/b.vcf', 0, 'GRCh38')
    sqlite.variants.insertVariantsBatch(other, rows(300, 'B'))
    sqlite.cohortSummary.rebuild()
  })

  afterEach(() => sqlite.close())

  /** Small and large sets of overlapping and nested regions, padded past 0, plus a chr spelling no row has. */
  const regionSets = (): Array<Array<{ chr: string; start: number; end: number }>> =>
    [10, 50, 60, 400].map((count) => [
      { chr: '1', start: 950, end: 1050 },
      { chr: '1', start: 1000, end: 1020 },
      { chr: '3', start: 1, end: 2000 },
      { chr: 'X', start: -5000, end: 30 },
      ...Array.from({ length: count - 4 }, () => {
        const start = 1 + below(2000)
        return { chr: CHRS[below(4)], start, end: start + below(120) }
      })
    ])

  it('cohort view', () => {
    for (const set of regionSets()) {
      const expected = sqlite.database
        .prepare(
          `SELECT chr || ':' || pos || ':' || alt FROM cohort_variant_summary cvs WHERE cvs.rowid IN (${OVERLAP('cohort_variant_summary', '')}) ORDER BY 1`
        )
        .pluck()
        .all(JSON.stringify(set)) as string[]
      const result = sqlite.cohort.getCohortVariants({ panel_intervals: set, limit: 100_000 })

      expect(expected.length).toBeGreaterThan(20)
      expect(result.data.map((r) => `${r.chr}:${r.pos}:${r.alt}`).sort()).toEqual(expected)
      expect(result.total_count).toBe(expected.length)
    }
  })

  it('compiled case export', () => {
    for (const set of regionSets()) {
      const expected = sqlite.database
        .prepare(
          `SELECT id FROM variants WHERE case_id = ? AND id IN (${OVERLAP('variants', 'pv.case_id = ? AND')}) ORDER BY id`
        )
        .pluck()
        .all(caseId, JSON.stringify(set), caseId) as number[]
      const { sql, parameters } = sqlite.variants.compileExportQuery(
        { case_id: caseId, panel_intervals: set },
        100_000
      )
      const ids = (sqlite.database.prepare(sql).all(...(parameters as unknown[])) as Variant[])
        .map((r) => r.id)
        .sort((a, b) => a - b)

      expect(expected.length).toBeGreaterThan(20)
      expect(ids).toEqual(expected)
    }
  })

  it('keeps the named boundary rows in or out', () => {
    const set = [
      { chr: '1', start: 950, end: 1050 },
      ...Array.from({ length: 49 }, (_, i) => ({ chr: 'Y', start: i, end: i }))
    ]
    const alts = sqlite.cohort
      .getCohortVariants({ panel_intervals: set, limit: 100_000 })
      .data.map((r) => r.alt)
    expect(alts).toEqual(expect.arrayContaining(['ON_START', 'ON_END', 'TOUCHES_START']))
    for (const out of ['ENDS_BEFORE', 'PAST_END', 'STOPS_SHORT']) expect(alts).not.toContain(out)
  })
})
