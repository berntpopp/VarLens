import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import {
  createTables,
  createIndexes,
  createFTSTable,
  createFTSTriggers,
  initializeSchema
} from '../../../src/main/database/schema'

describe('Database Schema', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
  })

  afterEach(() => {
    db.close()
  })

  describe('createTables', () => {
    it('creates cases table with correct columns', () => {
      db.exec(createTables)

      const tableInfo = db.prepare("PRAGMA table_info('cases')").all() as Array<{
        name: string
        type: string
        notnull: number
        pk: number
      }>

      const columns = tableInfo.map((col) => col.name)
      expect(columns).toContain('id')
      expect(columns).toContain('name')
      expect(columns).toContain('file_path')
      expect(columns).toContain('file_size')
      expect(columns).toContain('variant_count')
      expect(columns).toContain('created_at')

      // Check id is primary key
      const idColumn = tableInfo.find((col) => col.name === 'id')
      expect(idColumn?.pk).toBe(1)
      expect(idColumn?.type).toBe('INTEGER')

      // Check name is TEXT NOT NULL
      const nameColumn = tableInfo.find((col) => col.name === 'name')
      expect(nameColumn?.type).toBe('TEXT')
      expect(nameColumn?.notnull).toBe(1)
    })

    it('creates variants table with correct columns', () => {
      db.exec(createTables)

      const tableInfo = db.prepare("PRAGMA table_info('variants')").all() as Array<{
        name: string
        type: string
        notnull: number
        pk: number
      }>

      const columns = tableInfo.map((col) => col.name)
      expect(columns).toContain('id')
      expect(columns).toContain('case_id')
      expect(columns).toContain('chr')
      expect(columns).toContain('pos')
      expect(columns).toContain('ref')
      expect(columns).toContain('alt')
      expect(columns).toContain('gene_symbol')
      expect(columns).toContain('consequence')
      expect(columns).toContain('gnomad_af')
      expect(columns).toContain('cadd')
      expect(columns).toContain('clinvar')

      // Check nullable columns
      const geneSymbolColumn = tableInfo.find((col) => col.name === 'gene_symbol')
      expect(geneSymbolColumn?.notnull).toBe(0) // nullable

      // Check non-nullable columns
      const chrColumn = tableInfo.find((col) => col.name === 'chr')
      expect(chrColumn?.notnull).toBe(1) // NOT NULL

      // Check types
      const gnomadColumn = tableInfo.find((col) => col.name === 'gnomad_af')
      expect(gnomadColumn?.type).toBe('REAL')
    })

    it('enforces unique constraint on case name', () => {
      db.exec(createTables)

      const insert = db.prepare(
        'INSERT INTO cases (name, file_path, file_size, variant_count, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      insert.run('test-case', '/path/to/file.vcf', 1024, 0, Date.now())

      // Second insert with same name should fail
      expect(() => {
        insert.run('test-case', '/path/to/other.vcf', 2048, 0, Date.now())
      }).toThrow(/UNIQUE constraint failed/)
    })
  })

  describe('createIndexes', () => {
    it('creates indexes on variants table', () => {
      db.exec(createTables)
      db.exec(createIndexes)

      const indexList = db.prepare("PRAGMA index_list('variants')").all() as Array<{
        name: string
      }>

      const indexNames = indexList.map((idx) => idx.name)
      expect(indexNames).toContain('idx_variants_case_id')
      expect(indexNames).toContain('idx_variants_gene')
      expect(indexNames).toContain('idx_variants_pos')
      expect(indexNames).toContain('idx_variants_filters')
    })
  })

  describe('createFTSTable', () => {
    it('creates FTS5 virtual table', () => {
      db.exec(createTables)
      db.exec(createFTSTable)

      // Check table exists by querying sqlite_master
      const result = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='variants_fts'")
        .get() as { name: string } | undefined

      expect(result?.name).toBe('variants_fts')
    })

    it('FTS5 table has correct columns', () => {
      db.exec(createTables)
      db.exec(createFTSTable)

      // FTS5 tables don't support PRAGMA table_info, but we can check
      // by inserting and querying
      db.exec(createFTSTriggers)

      // Insert a case and variant
      db.prepare(
        'INSERT INTO cases (name, file_path, file_size, variant_count, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run('test-case', '/path/to/file.vcf', 1024, 1, Date.now())

      db.prepare(
        'INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, consequence) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(1, '1', 12345, 'A', 'G', 'BRCA1', 'missense_variant')

      // Search in FTS table
      const result = db
        .prepare(
          `
        SELECT rowid, gene_symbol, consequence
        FROM variants_fts
        WHERE variants_fts MATCH 'BRCA1'
      `
        )
        .get() as { rowid: number; gene_symbol: string; consequence: string } | undefined

      expect(result?.gene_symbol).toBe('BRCA1')
      expect(result?.consequence).toBe('missense_variant')
    })
  })

  describe('createFTSTriggers', () => {
    beforeEach(() => {
      db.exec(createTables)
      db.exec(createFTSTable)
      db.exec(createFTSTriggers)

      // Insert a case
      db.prepare(
        'INSERT INTO cases (name, file_path, file_size, variant_count, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run('test-case', '/path/to/file.vcf', 1024, 0, Date.now())
    })

    it('INSERT trigger adds to FTS index', () => {
      db.prepare(
        'INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, consequence) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(1, '1', 12345, 'A', 'G', 'TP53', 'stop_gained')

      const result = db
        .prepare("SELECT rowid FROM variants_fts WHERE variants_fts MATCH 'TP53'")
        .get() as { rowid: number } | undefined

      expect(result?.rowid).toBe(1)
    })

    it('DELETE trigger removes from FTS index', () => {
      db.prepare(
        'INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, consequence) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(1, '1', 12345, 'A', 'G', 'EGFR', 'missense_variant')

      // Verify it's in FTS
      let result = db
        .prepare("SELECT rowid FROM variants_fts WHERE variants_fts MATCH 'EGFR'")
        .get() as { rowid: number } | undefined
      expect(result?.rowid).toBe(1)

      // Delete the variant
      db.prepare('DELETE FROM variants WHERE id = 1').run()

      // Verify it's removed from FTS
      result = db
        .prepare("SELECT rowid FROM variants_fts WHERE variants_fts MATCH 'EGFR'")
        .get() as { rowid: number } | undefined
      expect(result).toBeUndefined()
    })

    it('UPDATE trigger updates FTS index', () => {
      db.prepare(
        'INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, consequence) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(1, '1', 12345, 'A', 'G', 'KRAS', 'missense_variant')

      // Update gene_symbol
      db.prepare('UPDATE variants SET gene_symbol = ? WHERE id = 1').run('NRAS')

      // Old value should not be found
      let result = db
        .prepare("SELECT rowid FROM variants_fts WHERE variants_fts MATCH 'KRAS'")
        .get() as { rowid: number } | undefined
      expect(result).toBeUndefined()

      // New value should be found
      result = db
        .prepare("SELECT rowid FROM variants_fts WHERE variants_fts MATCH 'NRAS'")
        .get() as { rowid: number } | undefined
      expect(result?.rowid).toBe(1)
    })
  })

  describe('initializeSchema', () => {
    it('creates all tables', () => {
      initializeSchema(db)

      const tables = db
        .prepare(
          `
        SELECT name FROM sqlite_master
        WHERE type='table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `
        )
        .all() as Array<{ name: string }>

      const tableNames = tables.map((t) => t.name)
      expect(tableNames).toContain('cases')
      expect(tableNames).toContain('variants')
      expect(tableNames).toContain('variants_fts')
    })

    it('creates all indexes', () => {
      initializeSchema(db)

      const indexes = db
        .prepare(
          `
        SELECT name FROM sqlite_master
        WHERE type='index' AND name LIKE 'idx_%'
      `
        )
        .all() as Array<{ name: string }>

      expect(indexes.length).toBe(9)
    })

    it('creates all triggers', () => {
      initializeSchema(db)

      const triggers = db
        .prepare(
          `
        SELECT name FROM sqlite_master
        WHERE type='trigger'
      `
        )
        .all() as Array<{ name: string }>

      const triggerNames = triggers.map((t) => t.name)
      expect(triggerNames).toContain('variants_fts_ai')
      expect(triggerNames).toContain('variants_fts_ad')
      expect(triggerNames).toContain('variants_fts_au')
    })

    it('is idempotent (can be called multiple times)', () => {
      // Should not throw when called multiple times
      initializeSchema(db)
      initializeSchema(db)
      initializeSchema(db)

      const tables = db
        .prepare(
          `
        SELECT name FROM sqlite_master
        WHERE type='table' AND name = 'cases'
      `
        )
        .all() as Array<{ name: string }>

      expect(tables.length).toBe(1)
    })
  })

  describe('Foreign Key Constraint', () => {
    it('prevents inserting variant with invalid case_id', () => {
      initializeSchema(db)

      // Try to insert variant without a valid case
      expect(() => {
        db.prepare(
          'INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, consequence) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(999, '1', 12345, 'A', 'G', 'BRCA1', 'missense_variant')
      }).toThrow(/FOREIGN KEY constraint failed/)
    })

    it('cascades delete to variants when case is deleted', () => {
      initializeSchema(db)

      // Insert case
      db.prepare(
        'INSERT INTO cases (name, file_path, file_size, variant_count, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run('test-case', '/path/to/file.vcf', 1024, 2, Date.now())

      // Insert variants
      const insertVariant = db.prepare(
        'INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, consequence) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      insertVariant.run(1, '1', 12345, 'A', 'G', 'BRCA1', 'missense_variant')
      insertVariant.run(1, '2', 67890, 'C', 'T', 'TP53', 'stop_gained')

      // Verify variants exist
      let variants = db.prepare('SELECT COUNT(*) as count FROM variants').get() as { count: number }
      expect(variants.count).toBe(2)

      // Delete the case
      db.prepare('DELETE FROM cases WHERE id = 1').run()

      // Verify variants are deleted
      variants = db.prepare('SELECT COUNT(*) as count FROM variants').get() as { count: number }
      expect(variants.count).toBe(0)
    })
  })

  describe('FTS5 Search Features', () => {
    beforeEach(() => {
      initializeSchema(db)

      // Insert test case
      db.prepare(
        'INSERT INTO cases (name, file_path, file_size, variant_count, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run('test-case', '/path/to/file.vcf', 1024, 3, Date.now())

      // Insert test variants
      const insertVariant = db.prepare(
        'INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, consequence) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      insertVariant.run(1, '17', 41276045, 'A', 'G', 'BRCA1', 'missense_variant')
      insertVariant.run(1, '13', 32315474, 'C', 'T', 'BRCA2', 'frameshift_variant')
      insertVariant.run(1, '7', 55259515, 'G', 'A', 'EGFR', 'stop_gained')
    })

    it('supports prefix search', () => {
      const results = db
        .prepare(
          `
        SELECT v.gene_symbol
        FROM variants v
        JOIN variants_fts fts ON v.id = fts.rowid
        WHERE variants_fts MATCH 'BRC*'
        ORDER BY v.gene_symbol
      `
        )
        .all() as Array<{ gene_symbol: string }>

      expect(results.length).toBe(2)
      expect(results[0].gene_symbol).toBe('BRCA1')
      expect(results[1].gene_symbol).toBe('BRCA2')
    })

    it('supports case-insensitive search', () => {
      const result = db
        .prepare(
          `
        SELECT v.gene_symbol
        FROM variants v
        JOIN variants_fts fts ON v.id = fts.rowid
        WHERE variants_fts MATCH 'brca1'
      `
        )
        .get() as { gene_symbol: string } | undefined

      expect(result?.gene_symbol).toBe('BRCA1')
    })

    it('supports searching by consequence', () => {
      const results = db
        .prepare(
          `
        SELECT v.gene_symbol
        FROM variants v
        JOIN variants_fts fts ON v.id = fts.rowid
        WHERE variants_fts MATCH 'stop_gained'
      `
        )
        .all() as Array<{ gene_symbol: string }>

      expect(results.length).toBe(1)
      expect(results[0].gene_symbol).toBe('EGFR')
    })
  })
})
