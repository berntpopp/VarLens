/**
 * Migration v41 (#469): `impact_rank` / `clinvar_rank` on `variants` and on the
 * cohort summary, and the backfill of rows written before the ranks existed.
 * The backfill must give what an import writes, be safe to run again, work on
 * the legacy table shapes older migration tests start from, keep full-text
 * search intact, and run through SQLCipher.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseService } from '../../../src/main/database/DatabaseService'
import { initializeSchema } from '../../../src/main/database/schema'
import { LATEST_SQLITE_SCHEMA_VERSION, runMigrations } from '../../../src/main/database/migrations'
import { backfillVariantSeverityRanks } from '../../../src/main/database/severity-rank-migration'
import { clinvarRank, impactRank } from '../../../src/shared/config/severity.config'

/** Legacy rows: [consequence (impact), clinvar]. */
const LEGACY: Array<[string | null, string | null]> = [
  ['HIGH', 'Pathogenic'],
  ['MODERATE', 'Pathogenic/Likely_pathogenic'],
  ['LOW', 'Conflicting_interpretations_of_pathogenicity'],
  ['MODIFIER', 'uncertain_significance&likely_benign'],
  [' high ', 'Benign/Likely_benign|other'],
  ['missense_variant', 'something new'],
  [null, null],
  ['MODIFIER', 'not_provided']
]

const EXPECTED = LEGACY.map(([consequence, clinvar]) => ({
  consequence,
  clinvar,
  impact_rank: impactRank(consequence),
  clinvar_rank: clinvarRank(clinvar)
}))

const rankColumns = (db: Database.Database, table: string): unknown[] =>
  (
    db.prepare(`PRAGMA table_info('${table}')`).all() as Array<{
      name: string
      type: string
      notnull: number
      dflt_value: string
    }>
  )
    .filter((column) => column.name.endsWith('_rank'))
    .map(({ name, type, notnull, dflt_value }) => ({ name, type, notnull, dflt_value }))

const RANK_COLUMNS = [
  { name: 'impact_rank', type: 'INTEGER', notnull: 1, dflt_value: '0' },
  { name: 'clinvar_rank', type: 'INTEGER', notnull: 1, dflt_value: '0' }
]

const ranks = (db: Database.Database): unknown[] =>
  db
    .prepare('SELECT consequence, clinvar, impact_rank, clinvar_rank FROM variants ORDER BY pos')
    .all()

/** Take a current database back to what v40 looked like. */
function rollBackToV40(db: Database.Database): void {
  for (const table of ['variants', 'cohort_variant_summary']) {
    db.exec(`ALTER TABLE ${table} DROP COLUMN impact_rank`)
    db.exec(`ALTER TABLE ${table} DROP COLUMN clinvar_rank`)
  }
  db.pragma('user_version = 40')
}

function insertLegacyRows(db: Database.Database): void {
  db.exec(`
    INSERT INTO cases (name, file_path, file_size, variant_count, created_at, genome_build)
    VALUES ('old', '/old.vcf', 1, 0, 0, 'GRCh38')`)
  const insert = db.prepare(
    `INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, consequence, clinvar, gt_num)
     VALUES (1, 'chr1', ?, 'A', 'G', ?, ?, ?, '0/1')`
  )
  LEGACY.forEach(([consequence, clinvar], index) =>
    insert.run(100 + index, `GENE${index}`, consequence, clinvar)
  )
}

describe('Migration v41: annotation severity ranks', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
  })

  afterEach(() => {
    db.close()
  })

  it('is the latest schema version', () => {
    expect(LATEST_SQLITE_SCHEMA_VERSION).toBe(41)
    expect(db.pragma('user_version', { simple: true })).toBe(41)
  })

  it('a new database has NOT NULL rank columns defaulting to 0', () => {
    expect(rankColumns(db, 'variants')).toEqual(RANK_COLUMNS)
    expect(rankColumns(db, 'cohort_variant_summary')).toEqual(RANK_COLUMNS)
  })

  it('upgrades a v40 database: legacy rows get the ranks an import would have written', () => {
    rollBackToV40(db)
    insertLegacyRows(db)

    runMigrations(db)

    expect(db.pragma('user_version', { simple: true })).toBe(41)
    expect(ranks(db)).toEqual(EXPECTED)
    // Not all zero, or the comparison above would prove nothing.
    expect(EXPECTED.slice(0, 5)).toEqual([
      expect.objectContaining({ impact_rank: 4, clinvar_rank: 15 }),
      expect.objectContaining({ impact_rank: 3, clinvar_rank: 14 }),
      expect.objectContaining({ impact_rank: 2, clinvar_rank: 12 }),
      expect.objectContaining({ impact_rank: 1, clinvar_rank: 11 }),
      expect.objectContaining({ impact_rank: 4, clinvar_rank: 3 })
    ])
  })

  it('runs again over its own result without writing a row', () => {
    rollBackToV40(db)
    insertLegacyRows(db)
    runMigrations(db)

    const changesBefore = db.prepare('SELECT total_changes() AS c').get() as { c: number }
    db.pragma('user_version = 40')
    runMigrations(db)
    backfillVariantSeverityRanks(db)

    // Two more runs, each writing only its temporary lookup rows: no variant row.
    const lookupRows = new Set(
      LEGACY.map(([, clinvar]) => clinvar).filter((clinvar) => clinvarRank(clinvar) > 0)
    )
    const changesAfter = db.prepare('SELECT total_changes() AS c').get() as { c: number }
    expect(changesAfter.c - changesBefore.c).toBe(2 * lookupRows.size)
    expect(ranks(db)).toEqual(EXPECTED)
  })

  it('keeps the full-text index and its update trigger', () => {
    rollBackToV40(db)
    insertLegacyRows(db)
    runMigrations(db)

    const search = (term: string): unknown[] =>
      db.prepare('SELECT rowid FROM variants_fts WHERE variants_fts MATCH ?').all(term)
    expect(search('GENE3')).toHaveLength(1)
    // The trigger is back: an edit still re-indexes the row.
    db.exec("UPDATE variants SET gene_symbol = 'RENAMED' WHERE pos = 103")
    expect(search('GENE3')).toHaveLength(0)
    expect(search('RENAMED')).toHaveLength(1)
  })

  it('a failure mid-way leaves nothing half done, and the next start completes it', () => {
    rollBackToV40(db)
    insertLegacyRows(db)
    const triggers = (): unknown[] =>
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all()
    const before = triggers()

    // The process dies on the UPDATE, after the search trigger was suspended.
    const exec = db.exec.bind(db)
    db.exec = ((sql: string) => {
      if (/UPDATE variants/.test(sql)) throw new Error('simulated crash')
      return exec(sql)
    }) as typeof db.exec
    expect(() => runMigrations(db)).toThrow('simulated crash')
    db.exec = exec

    // Still v40, with its search trigger, and no partial ranks.
    expect(db.pragma('user_version', { simple: true })).toBe(40)
    expect(triggers()).toEqual(before)

    runMigrations(db)
    expect(db.pragma('user_version', { simple: true })).toBe(41)
    expect(triggers()).toEqual(before)
    expect(ranks(db)).toEqual(EXPECTED)
  })

  it('flags a populated cohort summary stale, and leaves an empty one current', () => {
    const stale = (): unknown =>
      (
        db.prepare("SELECT value FROM cohort_summary_meta WHERE key = 'is_stale'").get() as
          { value: string } | undefined
      )?.value
    rollBackToV40(db)
    db.exec("INSERT OR REPLACE INTO cohort_summary_meta (key, value) VALUES ('is_stale', '0')")
    runMigrations(db)
    expect(stale()).toBe('0')

    rollBackToV40(db)
    db.exec(`
      INSERT INTO cohort_variant_summary
        (chr, pos, ref, alt, variant_type, genome_build, carrier_count, het_count, hom_count,
         variant_key)
      VALUES ('chr1', 100, 'A', 'G', 'snv', 'GRCh38', 1, 1, 0, 'chr1:100:A:G')`)
    runMigrations(db)
    expect(stale()).toBe('1')
  })

  it('handles a legacy variants table without the annotation columns', () => {
    const legacy = new Database(':memory:')
    try {
      legacy.exec('CREATE TABLE variants (id INTEGER PRIMARY KEY, chr TEXT, consequence TEXT)')
      legacy.exec("INSERT INTO variants (chr, consequence) VALUES ('chr1', 'HIGH')")
      legacy.pragma('user_version = 40')

      runMigrations(legacy)

      expect(legacy.pragma('user_version', { simple: true })).toBe(41)
      expect(legacy.prepare('SELECT impact_rank, clinvar_rank FROM variants').all()).toEqual([
        { impact_rank: 4, clinvar_rank: 0 }
      ])
    } finally {
      legacy.close()
    }
  })

  it('handles a database without a variants table', () => {
    const empty = new Database(':memory:')
    try {
      empty.pragma('user_version = 40')
      expect(() => runMigrations(empty)).not.toThrow()
      expect(empty.pragma('user_version', { simple: true })).toBe(41)
    } finally {
      empty.close()
    }
  })

  describe('through SQLCipher', () => {
    const KEY = 'correct horse battery staple'
    let dir: string

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'varlens-migration-v41-'))
    })

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true })
    })

    it('upgrades an encrypted v40 database when it is opened', () => {
      const path = join(dir, 'encrypted.db')
      const created = new DatabaseService(path, KEY)
      rollBackToV40(created.database)
      insertLegacyRows(created.database)
      created.close()

      const reopened = new DatabaseService(path, KEY)
      try {
        expect(reopened.isEncrypted()).toBe(true)
        expect(reopened.database.pragma('user_version', { simple: true })).toBe(41)
        expect(ranks(reopened.database)).toEqual(EXPECTED)
        // The summary built on the upgraded rows carries the ranks.
        reopened.cohortSummary.rebuild()
        expect(
          reopened.database
            .prepare('SELECT impact_rank, clinvar_rank FROM cohort_variant_summary WHERE pos = 100')
            .get()
        ).toEqual({ impact_rank: 4, clinvar_rank: 15 })
      } finally {
        reopened.close()
      }
    })
  })
})
