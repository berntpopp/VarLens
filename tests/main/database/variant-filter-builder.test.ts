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
    it('applies default sort (pos ASC, id ASC) when no sortBy', () => {
      const query = builder.build({ case_id: caseId })
      const sorted = builder.applySort(query)
      const compiled = sorted.compile()
      expect(compiled.sql).toContain('order by')
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
})
