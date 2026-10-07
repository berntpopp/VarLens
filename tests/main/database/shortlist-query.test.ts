/**
 * Tests for `queryVariantsByType` — Stage 1 of the unified shortlist pipeline.
 *
 * The helper is the ONLY DB-touching module in the shortlist hot path
 * (spec §3 stage boundary commitment). These tests verify:
 *
 * 1. The row projection matches the `ShortlistCandidate` contract — every
 *    base `Variant` field plus the aliased `sv_*` / `cnv_*` / `str_*`
 *    extension columns and the derived `is_starred` boolean.
 * 2. Extension LEFT JOINs emit the correct aliases so extension columns
 *    flatten onto the row.
 * 3. `buildBaseWhere` filter translation is applied to the query, so a
 *    merged `FilterState` snapshot restricts the result set.
 * 4. The `limit` cap is honoured.
 * 5. `is_starred` is hydrated as a boolean from
 *    `case_variant_annotations.starred` (LEFT JOIN `COALESCE(…, 0)`).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'
import { createRepositories } from '../../../src/main/database/createRepositories'
import {
  queryVariantsByType,
  toShortlistVariantFilter
} from '../../../src/main/database/shortlist-query'
import { VariantFilterBuilder } from '../../../src/main/database/VariantFilterBuilder'
import { VariantSearchService } from '../../../src/main/database/VariantSearchService'
import type { FilterState } from '../../../src/shared/types/filters'
import type { ShortlistCandidate, VariantTypeKey } from '../../../src/shared/types/shortlist'

function insertCase(db: DatabaseType, caseId: number, name: string): void {
  db.prepare(
    `INSERT INTO cases (id, name, file_path, file_size, variant_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(caseId, name, `/test/${name}.vcf`, 1000, 0, Date.now())
}

function seedMinimalCase(db: DatabaseType, caseId: number): void {
  insertCase(db, caseId, `case-${caseId}`)

  // SNV row — exercises base-column filters (consequence, gnomad_af, clinvar)
  db.prepare(
    `INSERT INTO variants (id, case_id, variant_type, chr, pos, ref, alt,
       gene_symbol, consequence, cadd, gnomad_af, clinvar)
     VALUES (?, ?, 'snv', '1', 1000, 'A', 'T', 'BRCA1', 'HIGH', 35, 0.0001, 'Pathogenic')`
  ).run(1, caseId)

  // SV row — variant_sv extension table
  db.prepare(
    `INSERT INTO variants (id, case_id, variant_type, chr, pos, ref, alt,
       gene_symbol, sv_length, sv_type)
     VALUES (?, ?, 'sv', '2', 2000, 'N', '<DEL>', 'DMD', 5000, 'DEL')`
  ).run(2, caseId)
  db.prepare(
    `INSERT INTO variant_sv (variant_id, sv_is_precise, vaf, support)
     VALUES (?, 1, 0.45, 42)`
  ).run(2)

  // CNV row — variant_cnv extension table
  db.prepare(
    `INSERT INTO variants (id, case_id, variant_type, chr, pos, ref, alt, gene_symbol)
     VALUES (?, ?, 'cnv', '3', 3000, 'N', '<CNV>', 'SMN1')`
  ).run(3, caseId)
  db.prepare(
    `INSERT INTO variant_cnv (variant_id, copy_number, copy_number_quality)
     VALUES (?, 0, 95)`
  ).run(3)

  // STR row — variant_str extension table
  db.prepare(
    `INSERT INTO variants (id, case_id, variant_type, chr, pos, ref, alt, gene_symbol)
     VALUES (?, ?, 'str', '4', 4000, 'N', '<STR>', 'HTT')`
  ).run(4, caseId)
  db.prepare(
    `INSERT INTO variant_str (variant_id, str_status, disease, alt_copies)
     VALUES (?, 'pathologic', 'Huntington disease', '45')`
  ).run(4)
}

describe('queryVariantsByType()', () => {
  let db: DatabaseType

  let filterBuilder: VariantFilterBuilder

  /** Stage-1 query for one type, as ShortlistService runs it (no panel active). */
  function query(
    caseId: number,
    variantType: VariantTypeKey,
    filters: Partial<FilterState>,
    limit: number
  ): ShortlistCandidate[] {
    return queryVariantsByType(
      { db, filterBuilder },
      toShortlistVariantFilter(caseId, variantType, filters),
      limit
    )
  }

  beforeEach(() => {
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
    const { kysely } = createRepositories(db)
    filterBuilder = new VariantFilterBuilder(db, kysely, new VariantSearchService(db, kysely))
    seedMinimalCase(db, 1)
  })

  afterEach(() => {
    db.close()
  })

  it('returns SNV rows matching Variant shape + is_starred', () => {
    const rows = query(1, 'snv', {} as Partial<FilterState>, 100)
    expect(rows).toHaveLength(1)
    expect(rows[0].variant_type).toBe('snv')
    expect(rows[0].id).toBe(1)
    expect(rows[0].is_starred).toBe(false)
    expect(rows[0].gene_symbol).toBe('BRCA1')
  })

  it('flattens SV extension columns into sv_* aliases', () => {
    const rows = query(1, 'sv', {} as Partial<FilterState>, 100)
    expect(rows).toHaveLength(1)
    expect(rows[0].sv_vaf).toBe(0.45)
    expect(rows[0].sv_is_precise).toBe(1)
    expect(rows[0].sv_support).toBe(42)
    // sv_length comes from v.* (base variants column), NOT aliased from the extension table.
    expect(rows[0].sv_length).toBe(5000)
    expect(rows[0].sv_type).toBe('DEL')
  })

  it('flattens CNV extension columns into cnv_* aliases', () => {
    const rows = query(1, 'cnv', {} as Partial<FilterState>, 100)
    expect(rows).toHaveLength(1)
    expect(rows[0].cnv_copy_number).toBe(0)
    expect(rows[0].cnv_copy_number_quality).toBe(95)
  })

  it('flattens STR extension columns into str_* aliases', () => {
    const rows = query(1, 'str', {} as Partial<FilterState>, 100)
    expect(rows).toHaveLength(1)
    expect(rows[0].str_status).toBe('pathologic')
    expect(rows[0].str_disease).toBe('Huntington disease')
    expect(rows[0].str_alt_copies).toBe('45')
  })

  it('leaves extension columns null for wrong-type rows', () => {
    const snvRows = query(1, 'snv', {} as Partial<FilterState>, 100)
    // Explicit null, as on PostgreSQL: both backends flatten rows through
    // the same toShortlistCandidate.
    expect(snvRows[0].sv_vaf).toBeNull()
    expect(snvRows[0].cnv_copy_number).toBeNull()
    expect(snvRows[0].str_status).toBeNull()
  })

  it('populates is_starred from case_variant_annotations', () => {
    db.prepare(
      `INSERT INTO case_variant_annotations (case_id, variant_id, starred, created_at, updated_at)
       VALUES (1, 1, 1, ?, ?)`
    ).run(Date.now(), Date.now())
    const rows = query(1, 'snv', {} as Partial<FilterState>, 100)
    expect(rows[0].is_starred).toBe(true)
  })

  it('treats starred=0 in case_variant_annotations as not starred', () => {
    db.prepare(
      `INSERT INTO case_variant_annotations (case_id, variant_id, starred, created_at, updated_at)
       VALUES (1, 1, 0, ?, ?)`
    ).run(Date.now(), Date.now())
    const rows = query(1, 'snv', {} as Partial<FilterState>, 100)
    expect(rows[0].is_starred).toBe(false)
  })

  it('respects the limit cap', () => {
    for (let i = 10; i < 20; i++) {
      db.prepare(
        `INSERT INTO variants (id, case_id, variant_type, chr, pos, ref, alt)
         VALUES (?, 1, 'snv', '1', ?, 'A', 'T')`
      ).run(i, i * 100)
    }
    const rows = query(1, 'snv', {} as Partial<FilterState>, 5)
    expect(rows).toHaveLength(5)
  })

  it('applies FilterState filters through buildBaseWhere (consequences)', () => {
    // Seed a second SNV so filter actually has to discriminate.
    db.prepare(
      `INSERT INTO variants (id, case_id, variant_type, chr, pos, ref, alt,
         gene_symbol, consequence)
       VALUES (?, 1, 'snv', '5', 5000, 'A', 'T', 'TP53', 'LOW')`
    ).run(5)

    const matched = query(1, 'snv', { consequences: ['HIGH'] } as Partial<FilterState>, 100)
    expect(matched).toHaveLength(1)
    expect(matched[0].consequence).toBe('HIGH')

    const empty = query(1, 'snv', { consequences: ['MODIFIER'] } as Partial<FilterState>, 100)
    expect(empty).toHaveLength(0)
  })

  it('applies maxGnomadAf filter from merged FilterState', () => {
    // Rare variant (gnomad_af = 0.0001) should pass; seed a common one.
    db.prepare(
      `INSERT INTO variants (id, case_id, variant_type, chr, pos, ref, alt,
         gene_symbol, consequence, gnomad_af)
       VALUES (?, 1, 'snv', '6', 6000, 'A', 'T', 'COMMON', 'MODERATE', 0.2)`
    ).run(6)

    const rare = query(1, 'snv', { maxGnomadAf: 0.01 } as Partial<FilterState>, 100)
    expect(rare).toHaveLength(1)
    expect(rare[0].gene_symbol).toBe('BRCA1')
  })

  it('scopes results to the requested case_id', () => {
    // Second case with its own SNV — shortlist query must NOT return it.
    insertCase(db, 2, 'case-2')
    db.prepare(
      `INSERT INTO variants (id, case_id, variant_type, chr, pos, ref, alt, gene_symbol)
       VALUES (?, 2, 'snv', '1', 1000, 'A', 'T', 'BRCA1')`
    ).run(99)

    const case1Rows = query(1, 'snv', {} as Partial<FilterState>, 100)
    expect(case1Rows).toHaveLength(1)
    expect(case1Rows[0].id).toBe(1)

    const case2Rows = query(2, 'snv', {} as Partial<FilterState>, 100)
    expect(case2Rows).toHaveLength(1)
    expect(case2Rows[0].id).toBe(99)
  })

  it('scopes results to the requested variant_type (no cross-type leakage)', () => {
    // SNV query must not surface the SV, CNV, STR rows seeded above.
    const snvRows = query(1, 'snv', {} as Partial<FilterState>, 100)
    expect(snvRows).toHaveLength(1)
    expect(snvRows[0].variant_type).toBe('snv')

    const svRows = query(1, 'sv', {} as Partial<FilterState>, 100)
    expect(svRows).toHaveLength(1)
    expect(svRows[0].variant_type).toBe('sv')
  })

  it('structural row shape matches ShortlistCandidate contract', () => {
    const rows = query(1, 'snv', {} as Partial<FilterState>, 100)
    const row = rows[0]
    // Required Variant fields
    expect(row).toHaveProperty('id')
    expect(row).toHaveProperty('case_id')
    expect(row).toHaveProperty('variant_type')
    expect(row).toHaveProperty('chr')
    expect(row).toHaveProperty('pos')
    expect(row).toHaveProperty('ref')
    expect(row).toHaveProperty('alt')
    // Annotation field
    expect(row).toHaveProperty('is_starred')
    expect(typeof row.is_starred).toBe('boolean')
  })

  it('orders Stage-1 rows by v.id ASC before applying the limit cap', () => {
    // Determinism guard: without `ORDER BY v.id` before `LIMIT`, SQLite
    // could silently return different rows on different invocations when
    // the per-type cap (`topN * 4`) bites — that would let the Stage-2
    // scorer see a nondeterministic candidate set. This test seeds more
    // rows than the cap and asserts the IDs returned are the lowest N.
    for (let i = 10; i < 30; i++) {
      db.prepare(
        `INSERT INTO variants (id, case_id, variant_type, chr, pos, ref, alt, consequence)
         VALUES (?, 1, 'snv', '1', ?, 'A', 'T', 'MODERATE')`
      ).run(i, i * 100)
    }
    const rows = query(1, 'snv', {} as Partial<FilterState>, 5)
    expect(rows).toHaveLength(5)
    const ids = rows.map((r) => r.id)
    // Deterministic lowest-5 IDs: existing id=1 (BRCA1) + ids 10-13.
    expect(ids).toEqual([1, 10, 11, 12, 13])
    // And assert ascending order as the contract guarantees.
    expect([...ids].sort((a, b) => a - b)).toEqual(ids)
  })

  it('snv scope is exact: indel rows are not swept in as on the variant table', () => {
    db.prepare(
      `INSERT INTO variants (id, case_id, variant_type, chr, pos, ref, alt)
       VALUES (40, 1, 'indel', '1', 1500, 'AT', 'A')`
    ).run()
    expect(query(1, 'snv', {}, 100).map((r) => r.id)).toEqual([1])
    expect(query(1, 'indel', {}, 100).map((r) => r.id)).toEqual([40])
  })

  describe('filters the SQLite shortlist used to ignore', () => {
    beforeEach(() => {
      // id 1 (seed): BRCA1, chr1:1000, gt_num NULL.
      db.prepare(
        `INSERT INTO variants (id, case_id, variant_type, chr, pos, ref, alt, gene_symbol, gt_num)
         VALUES (50, 1, 'snv', '1', 50000, 'C', 'G', 'TP53', '1/1'),
                (51, 1, 'snv', '2', 1000, 'C', 'G', 'EGFR', '0/1')`
      ).run()
    })

    const ids = (filters: Partial<FilterState>): number[] =>
      query(1, 'snv', filters, 100).map((r) => r.id)

    it('inheritanceModes restrict by genotype', () => {
      expect(ids({ inheritanceModes: ['homozygous'] })).toEqual([50])
      expect(ids({ inheritanceModes: ['heterozygous'] })).toEqual([51])
    })

    it('searchQuery restricts through full-text search', () => {
      expect(ids({ searchQuery: 'TP53' })).toEqual([50])
      expect(ids({ searchQuery: '' })).toEqual([1, 50, 51])
    })

    it('starredOnly restricts to variants starred in the case', () => {
      db.prepare(
        `INSERT INTO case_variant_annotations (case_id, variant_id, starred, created_at, updated_at)
         VALUES (1, 51, 1, ?, ?)`
      ).run(Date.now(), Date.now())
      const rows = query(1, 'snv', { starredOnly: true }, 100)
      expect(rows.map((r) => r.id)).toEqual([51])
      expect(rows[0].is_starred).toBe(true)
    })

    it('resolved panel regions restrict by overlap, small and large interval sets alike', () => {
      const region = { chr: '1', start: 40_000, end: 60_000 }
      const run = (intervals: Array<{ chr: string; start: number; end: number }>): number[] =>
        queryVariantsByType(
          { db, filterBuilder },
          { ...toShortlistVariantFilter(1, 'snv', {}), panel_intervals: intervals },
          100
        ).map((r) => r.id)

      expect(run([region])).toEqual([50])
      // >= 50 intervals switches the builder to its temp table.
      const padding = Array.from({ length: 60 }, (_, i) => ({
        chr: '20',
        start: i * 10 + 1,
        end: i * 10 + 5
      }))
      expect(run([...padding, region])).toEqual([50])
      expect(
        db.prepare("SELECT name FROM sqlite_temp_master WHERE name = '_panel_intervals'").all()
      ).toEqual([])
    })
  })
})
