/**
 * Tests for VariantSearchService — extracted from VariantRepository.
 *
 * Validates FTS5 search and gene symbol lookup using an in-memory SQLite database.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import type { Kysely } from 'kysely'
import type { VarlensDatabase } from '../../../src/shared/types/database-schema'
import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'
import { createKysely } from '../../../src/main/database/kysely'
import { VariantSearchService } from '../../../src/main/database/VariantSearchService'

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
  options: {
    chr?: string
    pos?: number
    gene_symbol?: string
    consequence?: string
    func?: string
    cdna?: string
    aa_change?: string
  }
): void {
  db.prepare(
    `INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, consequence, func, cdna, aa_change)
     VALUES (?, ?, ?, 'A', 'T', ?, ?, ?, ?, ?)`
  ).run(
    caseId,
    options.chr ?? '1',
    options.pos ?? 100000,
    options.gene_symbol ?? null,
    options.consequence ?? null,
    options.func ?? null,
    options.cdna ?? null,
    options.aa_change ?? null
  )
}

/**
 * Rebuild the FTS5 index from current variant data.
 * Required after direct INSERTs that bypass the FTS triggers.
 */
function rebuildFts(db: DatabaseType): void {
  db.exec("INSERT INTO variants_fts(variants_fts) VALUES('rebuild')")
}

// ─── Tests ────────────────────────────────────────────────────────

describe('VariantSearchService', () => {
  let db: DatabaseType
  let kysely: Kysely<VarlensDatabase>
  let service: VariantSearchService
  let caseId: number

  beforeEach(() => {
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
    kysely = createKysely(db)
    service = new VariantSearchService(db, kysely)

    caseId = insertCase(db, 'TestCase')
    insertVariant(db, caseId, {
      chr: '1',
      pos: 100000,
      gene_symbol: 'BRCA1',
      consequence: 'HIGH',
      func: 'stop_gained'
    })
    insertVariant(db, caseId, {
      chr: '2',
      pos: 200000,
      gene_symbol: 'BRCA2',
      consequence: 'MODERATE',
      func: 'missense_variant'
    })
    insertVariant(db, caseId, {
      chr: '3',
      pos: 300000,
      gene_symbol: 'TP53',
      consequence: 'LOW',
      func: 'synonymous_variant'
    })
    insertVariant(db, caseId, {
      chr: '4',
      pos: 400000,
      gene_symbol: 'KRAS',
      consequence: 'MODERATE',
      func: 'missense_variant',
      cdna: 'c.34G>T',
      aa_change: 'p.Gly12Cys'
    })
    rebuildFts(db)
  })

  afterEach(() => {
    kysely.destroy()
    db.close()
  })

  describe('getGeneSymbols', () => {
    it('returns matching gene symbols', () => {
      const results = service.getGeneSymbols(caseId, 'BRC')
      expect(results).toEqual(['BRCA1', 'BRCA2'])
    })

    it('returns empty array for no matches', () => {
      const results = service.getGeneSymbols(caseId, 'NONEXISTENT')
      expect(results).toEqual([])
    })

    it('respects limit parameter', () => {
      const results = service.getGeneSymbols(caseId, '', 2)
      expect(results).toHaveLength(2)
    })

    it('returns distinct values only', () => {
      // Insert duplicate gene symbol
      insertVariant(db, caseId, {
        chr: '5',
        pos: 500000,
        gene_symbol: 'BRCA1',
        consequence: 'MODERATE'
      })
      const results = service.getGeneSymbols(caseId, 'BRCA1')
      expect(results).toEqual(['BRCA1'])
    })
  })

  describe('searchVariants', () => {
    it('finds variants by gene symbol via FTS5', () => {
      const results = service.searchVariants(caseId, 'BRCA1')
      expect(results).toHaveLength(1)
      expect(results[0].gene_symbol).toBe('BRCA1')
    })

    it('finds variants by partial gene match (prefix)', () => {
      const results = service.searchVariants(caseId, 'BRC')
      expect(results).toHaveLength(2)
      const genes = results.map((r) => r.gene_symbol).sort()
      expect(genes).toEqual(['BRCA1', 'BRCA2'])
    })

    it('returns empty array for no matches', () => {
      const results = service.searchVariants(caseId, 'NONEXISTENT_GENE')
      expect(results).toEqual([])
    })

    it('respects limit parameter', () => {
      const results = service.searchVariants(caseId, 'BRC', 1)
      expect(results).toHaveLength(1)
    })

    it('does not return variants from other cases', () => {
      const otherCaseId = insertCase(db, 'OtherCase')
      insertVariant(db, otherCaseId, {
        chr: '1',
        pos: 100000,
        gene_symbol: 'EGFR',
        consequence: 'HIGH'
      })
      rebuildFts(db)

      const results = service.searchVariants(caseId, 'EGFR')
      expect(results).toEqual([])
    })
  })

  describe('applySearchFilter (via query builder integration)', () => {
    it('applies HGVS cDNA pattern as LIKE filter', () => {
      // Build a simple query and apply search for HGVS pattern
      const baseQuery = kysely.selectFrom('variants').selectAll().where('case_id', '=', caseId)
      const filtered = service.applySingleSearchToken(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        baseQuery as any,
        'c.34G>T'
      )
      const compiled = filtered.compile()
      const results = db.prepare(compiled.sql).all(...compiled.parameters) as Record<
        string,
        unknown
      >[]
      expect(results).toHaveLength(1)
      expect(results[0].gene_symbol).toBe('KRAS')
    })

    it('applies HGVS protein pattern as LIKE filter', () => {
      const baseQuery = kysely.selectFrom('variants').selectAll().where('case_id', '=', caseId)
      const filtered = service.applySingleSearchToken(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        baseQuery as any,
        'p.Gly12'
      )
      const compiled = filtered.compile()
      const results = db.prepare(compiled.sql).all(...compiled.parameters) as Record<
        string,
        unknown
      >[]
      expect(results).toHaveLength(1)
      expect(results[0].gene_symbol).toBe('KRAS')
    })

    it('applies regular term as FTS5 MATCH', () => {
      const baseQuery = kysely.selectFrom('variants').selectAll().where('case_id', '=', caseId)
      const filtered = service.applySingleSearchToken(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        baseQuery as any,
        'TP53'
      )
      const compiled = filtered.compile()
      const results = db.prepare(compiled.sql).all(...compiled.parameters) as Record<
        string,
        unknown
      >[]
      expect(results).toHaveLength(1)
      expect(results[0].gene_symbol).toBe('TP53')
    })
  })
})
