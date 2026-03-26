import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'

describe('Migration v13-v14: cohort summary tables', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initializeSchema(db)
  })

  afterEach(() => {
    db.close()
  })

  it('creates cohort_variant_summary table with correct schema', () => {
    runMigrations(db)
    const columns = db.prepare('PRAGMA table_info(cohort_variant_summary)').all() as {
      name: string
    }[]
    const colNames = columns.map((c) => c.name)
    expect(colNames).toContain('chr')
    expect(colNames).toContain('carrier_count')
    expect(colNames).toContain('het_count')
    expect(colNames).toContain('hom_count')
    expect(colNames).toContain('variant_key')
  })

  it('creates gene_burden_summary table', () => {
    runMigrations(db)
    const columns = db.prepare('PRAGMA table_info(gene_burden_summary)').all() as {
      name: string
    }[]
    const colNames = columns.map((c) => c.name)
    expect(colNames).toContain('gene_symbol')
    expect(colNames).toContain('variant_count')
    expect(colNames).toContain('affected_case_count')
  })

  it('creates cohort_summary_meta table', () => {
    runMigrations(db)
    const columns = db.prepare('PRAGMA table_info(cohort_summary_meta)').all() as {
      name: string
    }[]
    const colNames = columns.map((c) => c.name)
    expect(colNames).toContain('key')
    expect(colNames).toContain('value')
  })

  it('creates indexes on cohort_variant_summary', () => {
    runMigrations(db)
    const indexes = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='cohort_variant_summary'"
      )
      .all() as { name: string }[]
    const indexNames = indexes.map((i) => i.name)
    expect(indexNames).toContain('idx_cvs_gene_covering')
    expect(indexNames).toContain('idx_cvs_carrier')
    expect(indexNames).toContain('idx_cvs_filters')
    expect(indexNames).toContain('idx_cvs_covering_common')
  })

  it('is idempotent (safe to run twice)', () => {
    runMigrations(db)
    expect(() => runMigrations(db)).not.toThrow()
    const version = db.prepare('PRAGMA user_version').get() as { user_version: number }
    expect(version.user_version).toBe(18)
  })
})
