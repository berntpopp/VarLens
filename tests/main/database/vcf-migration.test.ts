import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'

describe('Migration v23: VCF import columns', () => {
  let db: DatabaseType
  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    initializeSchema(db)
  })
  afterEach(() => {
    db.close()
  })

  it('adds VCF columns to variants table', () => {
    runMigrations(db)
    const cols = db.prepare('PRAGMA table_info(variants)').all() as { name: string }[]
    const colNames = cols.map((c) => c.name)
    expect(colNames).toContain('gq')
    expect(colNames).toContain('dp')
    expect(colNames).toContain('ad_ref')
    expect(colNames).toContain('ad_alt')
    expect(colNames).toContain('ab')
    expect(colNames).toContain('filter')
    expect(colNames).toContain('info_json')
    expect(colNames).toContain('source_format')
  })

  it('adds VCF columns to cases table', () => {
    runMigrations(db)
    const cols = db.prepare('PRAGMA table_info(cases)').all() as { name: string }[]
    const colNames = cols.map((c) => c.name)
    expect(colNames).toContain('source_format')
    expect(colNames).toContain('sample_name')
  })

  it('creates partial index on info_json', () => {
    runMigrations(db)
    const indexes = db.prepare('PRAGMA index_list(variants)').all() as { name: string }[]
    expect(indexes.map((i) => i.name)).toContain('idx_variants_info_json')
  })

  it('sets user_version to latest', () => {
    runMigrations(db)
    const result = db.prepare('PRAGMA user_version').get() as { user_version: number }
    expect(result.user_version).toBe(25)
  })

  it('is idempotent — running migrations twice does not fail', () => {
    runMigrations(db)
    expect(() => runMigrations(db)).not.toThrow()
    const result = db.prepare('PRAGMA user_version').get() as { user_version: number }
    expect(result.user_version).toBe(25)
  })

  it('new variant columns are nullable and default to NULL', () => {
    runMigrations(db)
    // Insert a case first
    db.prepare(
      "INSERT INTO cases (name, file_path, file_size, variant_count, created_at, genome_build) VALUES ('test', '/test.tsv', 100, 0, ?, 'GRCh38')"
    ).run(Date.now())
    // Insert a minimal variant (no VCF columns)
    db.prepare(
      "INSERT INTO variants (case_id, chr, pos, ref, alt) VALUES (1, '1', 100, 'A', 'T')"
    ).run()
    const row = db
      .prepare(
        'SELECT gq, dp, ad_ref, ad_alt, ab, filter, info_json, source_format FROM variants WHERE id = 1'
      )
      .get() as Record<string, unknown>
    expect(row.gq).toBeNull()
    expect(row.dp).toBeNull()
    expect(row.ad_ref).toBeNull()
    expect(row.ad_alt).toBeNull()
    expect(row.ab).toBeNull()
    expect(row.filter).toBeNull()
    expect(row.info_json).toBeNull()
    expect(row.source_format).toBeNull()
  })
})
