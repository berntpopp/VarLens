/**
 * Tests for VariantRepository scope-aware single-column metadata API.
 *
 * Covers `getColumnMeta(scope, columnKey)` (base + extension paths) and
 * `getVariantTypesPresent(scope)`. The legacy full-column metadata path
 * (`getAllColumnMetas`) is still exercised via existing `getFilterOptions`
 * tests in variants.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DatabaseService } from '../../../src/main/database'

function createTestCase(db: DatabaseService, name: string): number {
  return db.cases.createCase(name, `/path/to/${name}.vcf`, 1024)
}

describe('VariantRepository — single-column metadata (scope-aware)', () => {
  let service: DatabaseService

  beforeEach(() => {
    service = new DatabaseService(':memory:')
  })

  afterEach(() => {
    service.close()
  })

  describe('getColumnMeta (base path)', () => {
    it('returns min/max/distinctCount for a numeric base column', () => {
      const caseId = createTestCase(service, 'base-numeric')
      service.variants.insertVariantsBatch(caseId, [
        { chr: '1', pos: 100, ref: 'A', alt: 'T', gnomad_af: 0.01 },
        { chr: '1', pos: 200, ref: 'A', alt: 'T', gnomad_af: 0.05 },
        { chr: '1', pos: 300, ref: 'A', alt: 'T', gnomad_af: null }
      ])

      const meta = service.variants.getColumnMeta({ caseId }, 'gnomad_af')
      expect(meta.key).toBe('gnomad_af')
      expect(meta.dataType).toBe('numeric')
      expect(meta.distinctCount).toBe(2)
      expect(meta.min).toBe(0.01)
      expect(meta.max).toBe(0.05)
    })

    // #505: these were reported as text, turning the SV length filter into a LIKE.
    it.each(['end_pos', 'sv_length'])('reports %s as a numeric column', (column) => {
      const caseId = createTestCase(service, 'base-sv-numeric')
      service.variants.insertVariantsBatch(caseId, [
        { chr: '1', pos: 100, ref: 'A', alt: '<DEL>', end_pos: 900, sv_length: 800 },
        { chr: '1', pos: 200, ref: 'A', alt: '<DEL>', end_pos: 10200, sv_length: 10000 }
      ])

      const single = service.variants.getColumnMeta({ caseId }, column)
      expect(single.dataType).toBe('numeric')
      expect([single.min, single.max]).toEqual(column === 'end_pos' ? [900, 10200] : [800, 10000])

      const all = service.variants.getFilterOptions(caseId).columnMeta
      expect(all?.find((m) => m.key === column)?.dataType).toBe('numeric')
    })

    it('returns distinctValues for a low-cardinality text column', () => {
      const caseId = createTestCase(service, 'base-text')
      service.variants.insertVariantsBatch(caseId, [
        { chr: '1', pos: 100, ref: 'A', alt: 'T', gene_symbol: 'BRCA1' },
        { chr: '1', pos: 200, ref: 'A', alt: 'T', gene_symbol: 'TP53' },
        { chr: '1', pos: 300, ref: 'A', alt: 'T', gene_symbol: 'BRCA1' }
      ])

      const meta = service.variants.getColumnMeta({ caseId }, 'gene_symbol')
      expect(meta.dataType).toBe('text')
      expect(meta.distinctCount).toBe(2)
      expect(meta.distinctValues).toEqual(['BRCA1', 'TP53'])
    })

    it('returns zeroed meta for unknown base columns', () => {
      const caseId = createTestCase(service, 'unknown-col')
      const meta = service.variants.getColumnMeta({ caseId }, 'nonexistent_column')
      expect(meta.distinctCount).toBe(0)
      expect(meta.dataType).toBe('text')
    })

    it('accepts cohort scope with caseIds array', () => {
      const caseA = createTestCase(service, 'cohortA')
      const caseB = createTestCase(service, 'cohortB')
      service.variants.insertVariantsBatch(caseA, [
        { chr: '1', pos: 100, ref: 'A', alt: 'T', gnomad_af: 0.01 }
      ])
      service.variants.insertVariantsBatch(caseB, [
        { chr: '1', pos: 200, ref: 'A', alt: 'T', gnomad_af: 0.1 }
      ])

      const meta = service.variants.getColumnMeta({ caseIds: [caseA, caseB] }, 'gnomad_af')
      expect(meta.distinctCount).toBe(2)
      expect(meta.min).toBe(0.01)
      expect(meta.max).toBe(0.1)
    })

    it('returns zero distinctCount for empty case (no variants)', () => {
      const caseId = createTestCase(service, 'empty')
      const meta = service.variants.getColumnMeta({ caseId }, 'gnomad_af')
      expect(meta.distinctCount).toBe(0)
    })

    it('returns zero distinctCount for empty caseIds array', () => {
      const meta = service.variants.getColumnMeta({ caseIds: [] }, 'gnomad_af')
      expect(meta.distinctCount).toBe(0)
    })
  })

  describe('getColumnMeta (extension path)', () => {
    function insertCnv(caseId: number, pos: number, copyNumber: number | null): void {
      const result = service.database
        .prepare(
          "INSERT INTO variants (case_id, chr, pos, ref, alt, variant_type) VALUES (?, '1', ?, 'N', '<CNV>', 'cnv')"
        )
        .run(caseId, pos)
      service.database
        .prepare('INSERT INTO variant_cnv (variant_id, copy_number) VALUES (?, ?)')
        .run(result.lastInsertRowid, copyNumber)
    }

    function insertStr(
      caseId: number,
      pos: number,
      fields: { disease?: string | null; str_status?: string | null }
    ): void {
      const result = service.database
        .prepare(
          "INSERT INTO variants (case_id, chr, pos, ref, alt, variant_type) VALUES (?, '4', ?, 'C', '<STR>', 'str')"
        )
        .run(caseId, pos)
      service.database
        .prepare('INSERT INTO variant_str (variant_id, disease, str_status) VALUES (?, ?, ?)')
        .run(result.lastInsertRowid, fields.disease ?? null, fields.str_status ?? null)
    }

    function insertSv(caseId: number, pos: number, support: number | null): void {
      const result = service.database
        .prepare(
          "INSERT INTO variants (case_id, chr, pos, ref, alt, variant_type) VALUES (?, '1', ?, 'N', '<DEL>', 'sv')"
        )
        .run(caseId, pos)
      service.database
        .prepare('INSERT INTO variant_sv (variant_id, support) VALUES (?, ?)')
        .run(result.lastInsertRowid, support)
    }

    it('returns min/max/distinctCount for cnv.copy_number', () => {
      const caseId = createTestCase(service, 'cnv-meta')
      insertCnv(caseId, 100, 2)
      insertCnv(caseId, 200, 3)
      insertCnv(caseId, 300, 5)

      const meta = service.variants.getColumnMeta({ caseId }, 'cnv.copy_number')
      expect(meta.key).toBe('cnv.copy_number')
      expect(meta.dataType).toBe('numeric')
      expect(meta.min).toBe(2)
      expect(meta.max).toBe(5)
      expect(meta.distinctCount).toBe(3)
    })

    it('returns distinctValues for str.disease (text with low cardinality)', () => {
      const caseId = createTestCase(service, 'str-meta')
      insertStr(caseId, 3074876, { disease: 'Huntington disease' })
      insertStr(caseId, 3075000, { disease: 'Fragile X syndrome' })
      insertStr(caseId, 3076000, { disease: 'Huntington disease' })

      const meta = service.variants.getColumnMeta({ caseId }, 'str.disease')
      expect(meta.dataType).toBe('text')
      expect(meta.distinctCount).toBe(2)
      expect(meta.distinctValues).toContain('Huntington disease')
      expect(meta.distinctValues).toContain('Fragile X syndrome')
    })

    it('str.str_status enum returns all distinct statuses', () => {
      const caseId = createTestCase(service, 'str-status')
      insertStr(caseId, 100, { str_status: 'full_mutation' })
      insertStr(caseId, 200, { str_status: 'premutation' })
      insertStr(caseId, 300, { str_status: 'normal' })

      const meta = service.variants.getColumnMeta({ caseId }, 'str.str_status')
      expect(meta.distinctCount).toBe(3)
      expect(meta.distinctValues).toEqual(['full_mutation', 'normal', 'premutation'])
    })

    it('sv.support returns numeric min/max', () => {
      const caseId = createTestCase(service, 'sv-support')
      insertSv(caseId, 100, 5)
      insertSv(caseId, 200, 15)
      insertSv(caseId, 300, 25)

      const meta = service.variants.getColumnMeta({ caseId }, 'sv.support')
      expect(meta.dataType).toBe('numeric')
      expect(meta.min).toBe(5)
      expect(meta.max).toBe(25)
      expect(meta.distinctCount).toBe(3)
    })

    it('returns zero distinctCount when extension table has no rows for scope', () => {
      const caseId = createTestCase(service, 'no-ext')
      // Only a SNV — no extension rows
      service.variants.insertVariantsBatch(caseId, [
        { chr: '1', pos: 100, ref: 'A', alt: 'T', gene_symbol: 'BRCA1' }
      ])

      const meta = service.variants.getColumnMeta({ caseId }, 'cnv.copy_number')
      expect(meta.distinctCount).toBe(0)
    })

    it('returns zeroed meta for unknown extension column', () => {
      const caseId = createTestCase(service, 'unknown-ext')
      const meta = service.variants.getColumnMeta({ caseId }, 'cnv.does_not_exist')
      expect(meta.distinctCount).toBe(0)
    })

    it('cohort scope (caseIds array) aggregates across multiple cases', () => {
      const caseA = createTestCase(service, 'cohortA')
      const caseB = createTestCase(service, 'cohortB')
      insertCnv(caseA, 100, 3)
      insertCnv(caseB, 200, 5)

      const meta = service.variants.getColumnMeta({ caseIds: [caseA, caseB] }, 'cnv.copy_number')
      expect(meta.min).toBe(3)
      expect(meta.max).toBe(5)
      expect(meta.distinctCount).toBe(2)
    })

    it('empty caseIds array returns zeroed meta', () => {
      const meta = service.variants.getColumnMeta({ caseIds: [] }, 'cnv.copy_number')
      expect(meta.distinctCount).toBe(0)
    })
  })

  describe('getVariantTypesPresent', () => {
    it('returns distinct types for a mixed case', () => {
      const caseId = createTestCase(service, 'mixed-types')
      service.variants.insertVariantsBatch(caseId, [
        { chr: '1', pos: 100, ref: 'A', alt: 'T' } // default variant_type='snv'
      ])
      // Direct insert for CNV + STR (skip the extension bulk-insert path)
      service.database
        .prepare(
          "INSERT INTO variants (case_id, chr, pos, ref, alt, variant_type) VALUES (?, '1', 200, 'N', '<CNV>', 'cnv')"
        )
        .run(caseId)
      service.database
        .prepare(
          "INSERT INTO variants (case_id, chr, pos, ref, alt, variant_type) VALUES (?, '4', 300, 'C', '<STR>', 'str')"
        )
        .run(caseId)

      const types = service.variants.getVariantTypesPresent({ caseId })
      expect(types.has('snv')).toBe(true)
      expect(types.has('cnv')).toBe(true)
      expect(types.has('str')).toBe(true)
      expect(types.has('sv')).toBe(false)
    })

    it('returns empty set for a case with no variants', () => {
      const caseId = createTestCase(service, 'empty')
      const types = service.variants.getVariantTypesPresent({ caseId })
      expect(types.size).toBe(0)
    })

    it('returns empty set for empty caseIds array', () => {
      const types = service.variants.getVariantTypesPresent({ caseIds: [] })
      expect(types.size).toBe(0)
    })

    it('cohort scope unions types across cases', () => {
      const caseA = createTestCase(service, 'snvOnly')
      const caseB = createTestCase(service, 'cnvOnly')
      service.variants.insertVariantsBatch(caseA, [{ chr: '1', pos: 100, ref: 'A', alt: 'T' }])
      service.database
        .prepare(
          "INSERT INTO variants (case_id, chr, pos, ref, alt, variant_type) VALUES (?, '1', 200, 'N', '<CNV>', 'cnv')"
        )
        .run(caseB)

      const types = service.variants.getVariantTypesPresent({ caseIds: [caseA, caseB] })
      expect(types.has('snv')).toBe(true)
      expect(types.has('cnv')).toBe(true)
    })
  })

  describe('getAllColumnMetas caching and invalidation (#671)', () => {
    it('returns identical cached array on repeated calls', () => {
      const caseId = createTestCase(service, 'cache-hit')
      service.variants.insertVariantsBatch(caseId, [
        { chr: '1', pos: 100, ref: 'A', alt: 'T', gene_symbol: 'BRCA1', gnomad_af: 0.01 },
        { chr: '1', pos: 200, ref: 'A', alt: 'T', gene_symbol: 'TP53', gnomad_af: 0.05 }
      ])

      const meta1 = service.variants.getAllColumnMetas(caseId)
      const meta2 = service.variants.getAllColumnMetas(caseId)
      expect(meta1).toBe(meta2) // exact same cached reference
    })

    it('invalidates cache when new variants are inserted via insertVariantsBatch', () => {
      const caseId = createTestCase(service, 'cache-invalidation-batch')
      service.variants.insertVariantsBatch(caseId, [
        { chr: '1', pos: 100, ref: 'A', alt: 'T', gene_symbol: 'BRCA1', gnomad_af: 0.01 }
      ])

      const meta1 = service.variants.getAllColumnMetas(caseId)
      expect(meta1.find((m) => m.key === 'gene_symbol')?.distinctValues).toEqual(['BRCA1'])

      service.variants.insertVariantsBatch(caseId, [
        { chr: '1', pos: 200, ref: 'A', alt: 'T', gene_symbol: 'TP53', gnomad_af: 0.05 }
      ])

      const meta2 = service.variants.getAllColumnMetas(caseId)
      expect(meta2).not.toBe(meta1)
      expect(meta2.find((m) => m.key === 'gene_symbol')?.distinctValues).toEqual(['BRCA1', 'TP53'])
    })

    it('invalidates cache when clearColumnMetaCache is called', () => {
      const caseId = createTestCase(service, 'cache-clear')
      service.variants.insertVariantsBatch(caseId, [
        { chr: '1', pos: 100, ref: 'A', alt: 'T', gene_symbol: 'BRCA1' }
      ])

      const meta1 = service.variants.getAllColumnMetas(caseId)
      service.variants.clearColumnMetaCache(caseId)
      const meta2 = service.variants.getAllColumnMetas(caseId)
      expect(meta2).not.toBe(meta1)
      expect(meta2).toEqual(meta1)
    })

    it('invalidates cache when variants table is mutated directly in SQLite', () => {
      const caseId = createTestCase(service, 'cache-direct-sql')
      service.variants.insertVariantsBatch(caseId, [
        { chr: '1', pos: 100, ref: 'A', alt: 'T', gene_symbol: 'BRCA1' }
      ])

      const meta1 = service.variants.getAllColumnMetas(caseId)

      service.database
        .prepare(
          "INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol) VALUES (?, '1', 200, 'A', 'G', 'TP53')"
        )
        .run(caseId)

      const meta2 = service.variants.getAllColumnMetas(caseId)
      expect(meta2).not.toBe(meta1)
      expect(meta2.find((m) => m.key === 'gene_symbol')?.distinctValues).toEqual(['BRCA1', 'TP53'])
    })

    it('invalidates cache when variants table is updated directly in SQLite (#671)', () => {
      const caseId = createTestCase(service, 'cache-direct-update')
      service.variants.insertVariantsBatch(caseId, [
        { chr: '1', pos: 100, ref: 'A', alt: 'T', gene_symbol: 'BRCA1' }
      ])

      const meta1 = service.variants.getAllColumnMetas(caseId)
      expect(meta1.find((m) => m.key === 'gene_symbol')?.distinctValues).toEqual(['BRCA1'])

      service.database
        .prepare("UPDATE variants SET gene_symbol = 'TP53' WHERE case_id = ? AND pos = 100")
        .run(caseId)

      const meta2 = service.variants.getAllColumnMetas(caseId)
      expect(meta2).not.toBe(meta1)
      expect(meta2.find((m) => m.key === 'gene_symbol')?.distinctValues).toEqual(['TP53'])
    })

    it('invalidates cache on INSERT OR REPLACE under same rowid/count', () => {
      const caseId = createTestCase(service, 'cache-direct-replace')
      service.variants.insertVariantsBatch(caseId, [
        { chr: '1', pos: 100, ref: 'A', alt: 'T', gene_symbol: 'BRCA1' }
      ])

      const meta1 = service.variants.getAllColumnMetas(caseId)
      expect(meta1.find((m) => m.key === 'gene_symbol')?.distinctValues).toEqual(['BRCA1'])

      // Warm cache hit & DDL assertion: zero CREATE or INSERT statements
      const execSpy = vi.spyOn(service.database, 'exec')
      const prepareSpy = vi.spyOn(service.database, 'prepare')

      const warm = service.variants.getAllColumnMetas(caseId)

      expect(warm).toBe(meta1)

      const ddlExecs = execSpy.mock.calls.filter(([sql]) => /CREATE|INSERT/i.test(String(sql)))
      const ddlPrepares = prepareSpy.mock.calls.filter(([sql]) =>
        /CREATE|INSERT/i.test(String(sql))
      )
      expect(ddlExecs.length).toBe(0)
      expect(ddlPrepares.length).toBe(0)

      execSpy.mockRestore()
      prepareSpy.mockRestore()

      const row = service.database
        .prepare('SELECT id FROM variants WHERE case_id = ?')
        .get(caseId) as { id: number }

      // Direct INSERT OR REPLACE with the same id and count
      service.database
        .prepare(
          "INSERT OR REPLACE INTO variants (id, case_id, chr, pos, ref, alt, gene_symbol) VALUES (?, ?, '1', 100, 'A', 'T', 'TP53')"
        )
        .run(row.id, caseId)

      const meta2 = service.variants.getAllColumnMetas(caseId)
      expect(meta2).not.toBe(meta1)
      expect(meta2.find((m) => m.key === 'gene_symbol')?.distinctValues).toEqual(['TP53'])
    })

    it('evicts oldest entries when cache exceeds MAX_META_CACHE_SIZE (50)', () => {
      const caseIds: number[] = []
      for (let i = 0; i < 55; i++) {
        const id = createTestCase(service, `case-${i}`)
        service.variants.insertVariantsBatch(id, [
          { chr: '1', pos: 100 + i, ref: 'A', alt: 'T', gene_symbol: `GENE${i}` }
        ])
        caseIds.push(id)
      }

      // Query all 55 cases into cache
      const cachedFirst = service.variants.getAllColumnMetas(caseIds[0])
      for (let i = 1; i < 55; i++) {
        service.variants.getAllColumnMetas(caseIds[i])
      }

      // caseIds[0] should have been evicted (oldest of >50)
      const reFetchedFirst = service.variants.getAllColumnMetas(caseIds[0])
      expect(reFetchedFirst).not.toBe(cachedFirst) // newly computed
    })
  })
})
