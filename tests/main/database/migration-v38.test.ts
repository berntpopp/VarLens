/**
 * Migration v38: the cohort frequency is derived at read time, so the index
 * on the stored `cohort_frequency` column is dropped. The column itself stays
 * (rollback safety) and its existing values are left alone.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { initializeSchema } from '../../../src/main/database/schema'
import { LATEST_SQLITE_SCHEMA_VERSION, runMigrations } from '../../../src/main/database/migrations'

describe('Migration v38: drop the cohort_frequency index', () => {
  let db: Database.Database

  const summaryIndexes = (): string[] =>
    (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'cohort_variant_summary'"
        )
        .all() as Array<{ name: string }>
    ).map((row) => row.name)

  const summaryColumns = (): string[] =>
    (
      db.prepare("PRAGMA table_info('cohort_variant_summary')").all() as Array<{ name: string }>
    ).map((row) => row.name)

  beforeEach(() => {
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
  })

  afterEach(() => {
    db.close()
  })

  it('a new database has the column but no index on it', () => {
    expect(db.pragma('user_version', { simple: true })).toBe(LATEST_SQLITE_SCHEMA_VERSION)
    expect(summaryIndexes()).not.toContain('idx_cvs_cohort_freq')
    expect(summaryColumns()).toContain('cohort_frequency')
  })

  it('upgrades a v37 database: drops the index, keeps the column and its stored values', () => {
    // Put the database back into its v37 shape.
    db.exec('CREATE INDEX idx_cvs_cohort_freq ON cohort_variant_summary(cohort_frequency)')
    db.exec(`
      INSERT INTO cohort_variant_summary
        (chr, pos, ref, alt, carrier_count, het_count, hom_count, cohort_frequency,
         variant_key, variant_type, genome_build)
      VALUES ('1', 100, 'A', 'G', 1, 1, 0, 0.25, '1:100:A:G', 'snv', 'GRCh38')
    `)
    db.pragma('user_version = 37')
    expect(summaryIndexes()).toContain('idx_cvs_cohort_freq')

    runMigrations(db)

    expect(db.pragma('user_version', { simple: true })).toBe(LATEST_SQLITE_SCHEMA_VERSION)
    expect(summaryIndexes()).not.toContain('idx_cvs_cohort_freq')
    expect(summaryIndexes()).toContain('idx_cvs_carrier_keyset')
    expect(summaryColumns()).toContain('cohort_frequency')
    expect(
      db.prepare('SELECT cohort_frequency FROM cohort_variant_summary WHERE pos = 100').get()
    ).toEqual({ cohort_frequency: 0.25 })

    // Re-running is a no-op.
    runMigrations(db)
    expect(db.pragma('user_version', { simple: true })).toBe(LATEST_SQLITE_SCHEMA_VERSION)
  })

  it('is the step from 37 to 38 exactly: a database already at 38 is not touched by it', () => {
    // Same index, but on a database that has the v38 step behind it. If the
    // drop were gated on any other version it would disappear here too.
    db.exec('CREATE INDEX idx_cvs_cohort_freq ON cohort_variant_summary(cohort_frequency)')
    db.pragma('user_version = 38')

    runMigrations(db)

    expect(db.pragma('user_version', { simple: true })).toBe(LATEST_SQLITE_SCHEMA_VERSION)
    expect(summaryIndexes()).toContain('idx_cvs_cohort_freq')
  })
})
