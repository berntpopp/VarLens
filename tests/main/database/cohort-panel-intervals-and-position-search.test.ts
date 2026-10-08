/**
 * Large gene panels (#491) and `chr`-prefixed position search (#492) on SQLite.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DatabaseService, type Variant } from '../../../src/main/database'

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

  it('drives the large-panel filter from the regions through an index', () => {
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
    expect(plan(compiled.sql, compiled.parameters)).toMatch(
      /SCAN iv VIRTUAL TABLE.*SEARCH pv USING (COVERING )?INDEX \S+ \(case_id=\? AND chr=\? AND pos<\?\)/
    )
    const cohortSql = `SELECT 1 FROM cohort_variant_summary cvs WHERE cvs.rowid IN (SELECT pv.rowid FROM json_each(?) iv CROSS JOIN cohort_variant_summary pv WHERE pv.chr = iv.value ->> 'chr' AND pv.pos <= iv.value ->> 'end' AND COALESCE(pv.end_pos, pv.pos) >= iv.value ->> 'start')`
    expect(plan(cohortSql, ['[]'])).toMatch(
      /SCAN iv VIRTUAL TABLE.*SEARCH pv USING (COVERING )?INDEX \S+ \(chr=\? AND pos<\?\)/
    )
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
