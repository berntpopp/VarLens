/**
 * Tests for VariantFilterBuilder — extracted from VariantRepository.
 *
 * Validates that the builder produces queries with expected WHERE clauses
 * for gene_symbol, consequences, gnomad_af, cadd, clinvar, and column filters.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import type { Kysely } from 'kysely'
import type { VarlensDatabase } from '../../../src/shared/types/database-schema'
import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'
import { createKysely } from '../../../src/main/database/kysely'
import { VariantFilterBuilder } from '../../../src/main/database/VariantFilterBuilder'
import type { VariantFilter } from '../../../src/main/database/types'

// ─── Helpers ───────────────────────────────────────────────────────

function insertCase(db: DatabaseType, name: string): number {
  const result = db
    .prepare(
      'INSERT INTO cases (name, file_path, file_size, variant_count, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    .run(name, `/test/${name}.vcf`, 1000, 0, Date.now())
  return result.lastInsertRowid as number
}

function insertVariant(
  db: DatabaseType,
  caseId: number,
  chr: string,
  pos: number,
  options: {
    gene_symbol?: string
    consequence?: string
    func?: string
    clinvar?: string
    gnomad_af?: number | null
    cadd?: number | null
  } = {}
): void {
  db.prepare(
    `INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, consequence, func, clinvar, gnomad_af, cadd)
     VALUES (?, ?, ?, 'A', 'T', ?, ?, ?, ?, ?, ?)`
  ).run(
    caseId,
    chr,
    pos,
    options.gene_symbol ?? null,
    options.consequence ?? null,
    options.func ?? null,
    options.clinvar ?? null,
    options.gnomad_af ?? null,
    options.cadd ?? null
  )
}

// ─── Tests ────────────────────────────────────────────────────────

describe('VariantFilterBuilder', () => {
  let db: DatabaseType
  let kysely: Kysely<VarlensDatabase>
  let builder: VariantFilterBuilder
  let caseId: number

  beforeEach(() => {
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
    kysely = createKysely(db)
    builder = new VariantFilterBuilder(db, kysely)

    caseId = insertCase(db, 'TestCase')
    insertVariant(db, caseId, '1', 100000, {
      gene_symbol: 'BRCA1',
      consequence: 'HIGH',
      func: 'stop_gained',
      clinvar: 'pathogenic',
      gnomad_af: 0.001,
      cadd: 35
    })
    insertVariant(db, caseId, '2', 200000, {
      gene_symbol: 'TP53',
      consequence: 'MODERATE',
      func: 'missense_variant',
      gnomad_af: 0.05,
      cadd: 20
    })
    insertVariant(db, caseId, '3', 300000, {
      gene_symbol: 'KRAS',
      consequence: 'LOW',
      func: 'synonymous_variant',
      gnomad_af: null,
      cadd: null
    })
  })

  afterEach(() => {
    kysely.destroy()
    db.close()
  })

  function executeQuery(filter: VariantFilter): Record<string, unknown>[] {
    const query = builder.build(filter)
    const compiled = query.compile()
    return db.prepare(compiled.sql).all(...compiled.parameters) as Record<string, unknown>[]
  }

  it('returns all variants for case with no filters', () => {
    const results = executeQuery({ case_id: caseId })
    expect(results).toHaveLength(3)
  })

  it('filters by gene_symbol (LIKE)', () => {
    const results = executeQuery({ case_id: caseId, gene_symbol: 'BRCA' })
    expect(results).toHaveLength(1)
    expect(results[0].gene_symbol).toBe('BRCA1')
  })

  it('filters by consequences array', () => {
    const results = executeQuery({ case_id: caseId, consequences: ['HIGH', 'LOW'] })
    expect(results).toHaveLength(2)
    const genes = results.map((r) => r.gene_symbol).sort()
    expect(genes).toEqual(['BRCA1', 'KRAS'])
  })

  it('filters by single consequence (legacy)', () => {
    const results = executeQuery({ case_id: caseId, consequence: 'MODERATE' })
    expect(results).toHaveLength(1)
    expect(results[0].gene_symbol).toBe('TP53')
  })

  it('consequences array takes precedence over single consequence', () => {
    const results = executeQuery({
      case_id: caseId,
      consequence: 'MODERATE',
      consequences: ['HIGH']
    })
    expect(results).toHaveLength(1)
    expect(results[0].gene_symbol).toBe('BRCA1')
  })

  it('filters by gnomad_af_max (NULL-inclusive)', () => {
    const results = executeQuery({ case_id: caseId, gnomad_af_max: 0.01 })
    // BRCA1 (0.001) passes, KRAS (null) passes, TP53 (0.05) excluded
    expect(results).toHaveLength(2)
    const genes = results.map((r) => r.gene_symbol).sort()
    expect(genes).toEqual(['BRCA1', 'KRAS'])
  })

  it('filters by cadd_min (NULL-inclusive)', () => {
    const results = executeQuery({ case_id: caseId, cadd_min: 25 })
    // BRCA1 (35) passes, KRAS (null) passes, TP53 (20) excluded
    expect(results).toHaveLength(2)
    const genes = results.map((r) => r.gene_symbol).sort()
    expect(genes).toEqual(['BRCA1', 'KRAS'])
  })

  it('filters by funcs array', () => {
    const results = executeQuery({ case_id: caseId, funcs: ['missense_variant'] })
    expect(results).toHaveLength(1)
    expect(results[0].gene_symbol).toBe('TP53')
  })

  it('filters by clinvars array', () => {
    const results = executeQuery({ case_id: caseId, clinvars: ['pathogenic'] })
    expect(results).toHaveLength(1)
    expect(results[0].gene_symbol).toBe('BRCA1')
  })

  it('filters by exact variant coordinates', () => {
    const results = executeQuery({ case_id: caseId, chr: '2', pos: 200000, ref: 'A', alt: 'T' })
    expect(results).toHaveLength(1)
    expect(results[0].gene_symbol).toBe('TP53')
  })

  it('combines multiple filters (AND)', () => {
    const results = executeQuery({
      case_id: caseId,
      consequences: ['HIGH', 'MODERATE'],
      gnomad_af_max: 0.01
    })
    // Only BRCA1 has HIGH consequence AND gnomad_af <= 0.01
    expect(results).toHaveLength(1)
    expect(results[0].gene_symbol).toBe('BRCA1')
  })

  describe('applySort', () => {
    it('applies default sort (chr ASC, pos ASC, id ASC) when no sortBy', () => {
      const query = builder.build({ case_id: caseId })
      const sorted = builder.applySort(query)
      const compiled = sorted.compile()
      expect(compiled.sql).toMatch(/order by chr ASC, pos ASC NULLS LAST, id ASC/)
      const results = db.prepare(compiled.sql).all(...compiled.parameters) as {
        chr: string
        pos: number
      }[]
      const keys = results.map((r) => `${r.chr}\u0000${String(r.pos).padStart(12, '0')}`)
      expect(keys).toEqual([...keys].sort())
    })

    it('applies custom sort direction', () => {
      const query = builder.build({ case_id: caseId })
      const sorted = builder.applySort(query, [{ key: 'gene_symbol', order: 'desc' }])
      const compiled = sorted.compile()
      const results = db.prepare(compiled.sql).all(...compiled.parameters) as Record<
        string,
        unknown
      >[]
      expect(results[0].gene_symbol).toBe('TP53')
    })

    it('ignores invalid sort columns', () => {
      const query = builder.build({ case_id: caseId })
      // Should not throw for invalid column
      const sorted = builder.applySort(query, [{ key: 'nonexistent_col', order: 'asc' }])
      const compiled = sorted.compile()
      const results = db.prepare(compiled.sql).all(...compiled.parameters) as Record<
        string,
        unknown
      >[]
      expect(results).toHaveLength(3)
    })
  })

  describe('panel intervals', () => {
    it('preparePanelIntervals returns false for small sets', () => {
      const filter: VariantFilter = {
        case_id: caseId,
        panel_intervals: [{ chr: '1', start: 0, end: 999999 }]
      }
      const result = builder.preparePanelIntervals(filter)
      expect(result).toBe(false)
    })

    it('preparePanelIntervals returns true and creates temp table for large sets', () => {
      const intervals = Array.from({ length: 60 }, (_, i) => ({
        chr: String((i % 22) + 1),
        start: i * 10000,
        end: i * 10000 + 5000
      }))
      const filter: VariantFilter = { case_id: caseId, panel_intervals: intervals }
      const result = builder.preparePanelIntervals(filter)
      expect(result).toBe(true)

      // Verify temp table exists
      const count = db.prepare('SELECT COUNT(*) as cnt FROM _panel_intervals').get() as {
        cnt: number
      }
      expect(count.cnt).toBe(60)

      builder.cleanupPanelIntervalsTable()
    })

    it('small panel intervals filter uses OR chain in compiled SQL', () => {
      const filter: VariantFilter = {
        case_id: caseId,
        panel_intervals: [
          { chr: '1', start: 99000, end: 101000 },
          { chr: '3', start: 299000, end: 301000 }
        ]
      }
      const query = builder.build(filter)
      const compiled = query.compile()
      // Verify the OR chain structure is present in the SQL
      expect(compiled.sql).toContain('"chr" = ?')
      expect(compiled.sql).toContain('"pos" >= ?')
      expect(compiled.sql).toContain('"pos" <= ?')
    })
  })

  describe('column_filters', () => {
    it('applies LIKE column filter', () => {
      const results = executeQuery({
        case_id: caseId,
        column_filters: {
          gene_symbol: { operator: 'like', value: 'BRC' }
        }
      })
      expect(results).toHaveLength(1)
      expect(results[0].gene_symbol).toBe('BRCA1')
    })

    it('applies IN column filter', () => {
      const results = executeQuery({
        case_id: caseId,
        column_filters: {
          consequence: { operator: 'in', value: ['HIGH', 'LOW'] }
        }
      })
      expect(results).toHaveLength(2)
    })

    it('applies range column filter with NULL inclusion', () => {
      const results = executeQuery({
        case_id: caseId,
        column_filters: {
          cadd: { operator: '>=', value: 25, includeEmpty: true }
        }
      })
      // BRCA1 (35) passes, KRAS (null) passes, TP53 (20) excluded
      expect(results).toHaveLength(2)
    })

    it('applies range column filter without NULL inclusion', () => {
      const results = executeQuery({
        case_id: caseId,
        column_filters: {
          cadd: { operator: '>=', value: 25, includeEmpty: false }
        }
      })
      // Only BRCA1 (35) passes
      expect(results).toHaveLength(1)
      expect(results[0].gene_symbol).toBe('BRCA1')
    })
  })

  // ── Extension-table (SV/CNV/STR) filter + sort scenarios ────────────
  describe('extension column_filters (dotted keys)', () => {
    function insertSvVariant(
      _caseId: number,
      pos: number,
      svFields: { support?: number | null; vaf?: number | null; event_id?: string | null }
    ): number {
      const result = db
        .prepare(
          `INSERT INTO variants (case_id, chr, pos, ref, alt, variant_type)
           VALUES (?, '1', ?, 'N', '<DEL>', 'sv')`
        )
        .run(_caseId, pos)
      const variantId = result.lastInsertRowid as number
      db.prepare(
        `INSERT INTO variant_sv (variant_id, support, vaf, event_id)
         VALUES (?, ?, ?, ?)`
      ).run(variantId, svFields.support ?? null, svFields.vaf ?? null, svFields.event_id ?? null)
      return variantId
    }

    function insertCnvVariant(_caseId: number, pos: number, copyNumber: number | null): number {
      const result = db
        .prepare(
          `INSERT INTO variants (case_id, chr, pos, ref, alt, variant_type)
           VALUES (?, '1', ?, 'N', '<CNV>', 'cnv')`
        )
        .run(_caseId, pos)
      const variantId = result.lastInsertRowid as number
      db.prepare(`INSERT INTO variant_cnv (variant_id, copy_number) VALUES (?, ?)`).run(
        variantId,
        copyNumber
      )
      return variantId
    }

    function insertStrVariant(
      _caseId: number,
      pos: number,
      strFields: {
        repeat_unit?: string | null
        disease?: string | null
        str_status?: string | null
      }
    ): number {
      const result = db
        .prepare(
          `INSERT INTO variants (case_id, chr, pos, ref, alt, variant_type)
           VALUES (?, '4', ?, 'C', '<STR>', 'str')`
        )
        .run(_caseId, pos)
      const variantId = result.lastInsertRowid as number
      db.prepare(
        `INSERT INTO variant_str (variant_id, repeat_unit, disease, str_status)
         VALUES (?, ?, ?, ?)`
      ).run(
        variantId,
        strFields.repeat_unit ?? null,
        strFields.disease ?? null,
        strFields.str_status ?? null
      )
      return variantId
    }

    it('filters by cnv.copy_number >= 3 (with implicit type narrowing)', () => {
      insertCnvVariant(caseId, 500000, 2)
      insertCnvVariant(caseId, 600000, 4)
      insertCnvVariant(caseId, 700000, 5)

      const results = executeQuery({
        case_id: caseId,
        column_filters: {
          'cnv.copy_number': { operator: '>=', value: 3 }
        }
      })
      // Only CNVs with copy_number >= 3 — narrowing to variant_type='cnv'
      // already excludes the 3 base SNVs from the fixture.
      expect(results).toHaveLength(2)
      for (const row of results) {
        expect(row.variant_type).toBe('cnv')
      }
    })

    it('filters by sv.support >= 10 and pairs with variant_type=sv', () => {
      insertSvVariant(caseId, 800000, { support: 5, vaf: 0.25 })
      insertSvVariant(caseId, 900000, { support: 15, vaf: 0.5 })
      insertSvVariant(caseId, 1000000, { support: 20, vaf: 0.75 })

      const results = executeQuery({
        case_id: caseId,
        variant_type: 'sv',
        column_filters: {
          'sv.support': { operator: '>=', value: 10 }
        }
      })
      expect(results).toHaveLength(2)
      for (const row of results) {
        expect(row.variant_type).toBe('sv')
      }
    })

    it('filters by str.disease LIKE (with NOCASE)', () => {
      insertStrVariant(caseId, 3074876, { repeat_unit: 'CAG', disease: 'Huntington disease' })
      insertStrVariant(caseId, 3075000, { repeat_unit: 'CGG', disease: 'Fragile X syndrome' })

      const results = executeQuery({
        case_id: caseId,
        column_filters: {
          'str.disease': { operator: 'like', value: 'huntington' }
        }
      })
      expect(results).toHaveLength(1)
      expect(results[0].variant_type).toBe('str')
    })

    it('cross-type filters span multiple extension tables (no single narrowing)', () => {
      insertCnvVariant(caseId, 500000, 5)
      insertSvVariant(caseId, 900000, { support: 15 })

      const results = executeQuery({
        case_id: caseId,
        column_filters: {
          'cnv.copy_number': { operator: '>=', value: 3 },
          'sv.support': { operator: '>=', value: 10 }
        }
      })
      // Each variant only matches its own extension table's filter; the other
      // filter is against a NULL column (LEFT JOIN) and fails (since these
      // extension filters default to EXCLUDE NULLs), so NEITHER variant
      // passes. This verifies cross-type filters AND together via AND.
      expect(results).toHaveLength(0)
    })

    it('str.str_status IN [...] returns only matching status values', () => {
      insertStrVariant(caseId, 3074876, {
        repeat_unit: 'CAG',
        disease: 'Huntington disease',
        str_status: 'full_mutation'
      })
      insertStrVariant(caseId, 3075000, {
        repeat_unit: 'CGG',
        disease: 'Fragile X',
        str_status: 'premutation'
      })
      insertStrVariant(caseId, 3076000, {
        repeat_unit: 'GCA',
        disease: 'Other',
        str_status: 'normal'
      })

      const results = executeQuery({
        case_id: caseId,
        column_filters: {
          'str.str_status': { operator: 'in', value: ['full_mutation', 'premutation'] }
        }
      })
      expect(results).toHaveLength(2)
    })

    it('ignores dotted keys for unknown extension columns', () => {
      const results = executeQuery({
        case_id: caseId,
        column_filters: {
          'cnv.does_not_exist': { operator: '>=', value: 99 }
        }
      })
      // Filter dropped — all 3 fixture variants returned
      expect(results).toHaveLength(3)
    })

    it('sort by cnv.copy_number adds LEFT JOIN and orders rows', () => {
      insertCnvVariant(caseId, 500000, 4)
      insertCnvVariant(caseId, 600000, 2)

      const query = builder.build(
        { case_id: caseId, variant_type: 'cnv' },
        { sortBy: [{ key: 'cnv.copy_number', order: 'desc' }] }
      )
      const sorted = builder.applySort(query, [{ key: 'cnv.copy_number', order: 'desc' }])
      const compiled = sorted.compile()
      const rows = db.prepare(compiled.sql).all(...compiled.parameters) as Record<string, unknown>[]
      expect(rows).toHaveLength(2)
      // Highest copy_number first
      expect(rows[0]._cnv_copy_number).toBe(4)
      expect(rows[1]._cnv_copy_number).toBe(2)
    })

    it('sort by sv.support with no filter still joins the SV table', () => {
      insertSvVariant(caseId, 800000, { support: 8 })
      insertSvVariant(caseId, 900000, { support: 12 })

      const query = builder.build(
        { case_id: caseId, variant_type: 'sv' },
        { sortBy: [{ key: 'sv.support', order: 'asc' }] }
      )
      const sorted = builder.applySort(query, [{ key: 'sv.support', order: 'asc' }])
      const compiled = sorted.compile()
      // Verify the join alias `sv` appears in the compiled SQL
      expect(compiled.sql).toContain('variant_sv')
      const rows = db.prepare(compiled.sql).all(...compiled.parameters) as Record<string, unknown>[]
      expect(rows).toHaveLength(2)
      expect(rows[0]._sv_support).toBe(8)
      expect(rows[1]._sv_support).toBe(12)
    })

    it('str filter join uses distinct "str" alias alongside "str_ext" projection', () => {
      insertStrVariant(caseId, 3074876, { repeat_unit: 'CAG', disease: 'Huntington disease' })

      // filter.variant_type='str' → str_ext alias for SELECT projection
      // column_filters 'str.disease' → str alias for WHERE predicate
      const results = executeQuery({
        case_id: caseId,
        variant_type: 'str',
        column_filters: {
          'str.disease': { operator: 'like', value: 'Huntington' }
        }
      })
      expect(results).toHaveLength(1)
      expect(results[0]._str_disease).toBe('Huntington disease')
    })
  })
})
