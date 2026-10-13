/**
 * Real-data regression (dev run 2026-10-12): a desktop database at v32 still had
 * the pre-v25 cohort summary keys (cohort_variant_summary PK chr,pos,ref,alt;
 * gene_burden_summary PK gene_symbol), so after migrating to v47 the summary
 * rebuild failed with a UNIQUE constraint as soon as one coordinate was both an
 * indel and an SV (or two builds shared a coordinate or a gene).
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DatabaseService } from '../../../src/main/database/DatabaseService'
import { LATEST_SQLITE_SCHEMA_VERSION, runMigrations } from '../../../src/main/database/migrations'
import { initializeSchema } from '../../../src/main/database/schema'
import { repairSummaryKeys } from '../../../src/main/database/summary-key-repair'

const pk = (db: Database.Database, table: string): string[] =>
  (db.prepare(`PRAGMA table_info('${table}')`).all() as Array<{ name: string; pk: number }>)
    .filter((c) => c.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((c) => c.name)

/** Give a current database the summary keys a pre-v25 one had, as found on real data. */
function degradeToLegacyKeys(db: Database.Database): void {
  for (const [table, key] of [
    ['cohort_variant_summary', 'PRIMARY KEY (chr, pos, ref, alt)'],
    ['gene_burden_summary', 'PRIMARY KEY (gene_symbol)']
  ] as const) {
    const cols = (
      db.prepare(`PRAGMA table_info('${table}')`).all() as Array<{
        name: string
        type: string
        notnull: number
        dflt_value: string | null
      }>
    ).map(
      (c) =>
        `"${c.name}" ${c.type}${c.notnull ? ' NOT NULL' : ''}${c.dflt_value !== null ? ` DEFAULT ${c.dflt_value}` : ''}`
    )
    db.exec(`DROP TABLE ${table}; CREATE TABLE ${table} (${cols.join(', ')}, ${key})`)
  }
}

describe('cohort summary keys on a drifted v32 database', () => {
  let dir: string
  let path: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cvs-keys-'))
    path = join(dir, 'drifted.db')
    const db = new Database(path)
    initializeSchema(db)
    runMigrations(db)
    degradeToLegacyKeys(db)
    db.exec('PRAGMA user_version = 32')
    const addCase = (name: string, build: string): number =>
      Number(
        db
          .prepare(
            `INSERT INTO cases (name, file_path, file_size, variant_count, created_at, genome_build, import_status)
             VALUES (?, '/gone.json', 0, 0, 0, ?, 'ready')`
          )
          .run(name, build).lastInsertRowid
      )
    const add = db.prepare(
      `INSERT INTO variants (case_id, chr, pos, ref, alt, variant_type, gene_symbol, gt_num)
       VALUES (?, ?, ?, ?, ?, ?, 'GENE1', '0/1')`
    )
    const a = addCase('A', 'GRCh38')
    add.run(a, 'chr1', 100, 'A', 'ATT', 'indel')
    add.run(a, 'chr1', 100, 'A', 'ATT', 'sv') // the same coordinate, called by an SV caller too
    const b = addCase('B', 'GRCh37')
    add.run(b, '1', 100, 'A', 'ATT', 'indel') // the same gene in another build
    db.close()
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('migrating to v47 restores the keys, and the summary rebuild succeeds', () => {
    const service = new DatabaseService(path)
    try {
      const db = service.database
      expect(db.pragma('user_version', { simple: true })).toBe(LATEST_SQLITE_SCHEMA_VERSION)
      expect(pk(db, 'cohort_variant_summary')).toEqual([
        'chr',
        'pos',
        'ref',
        'alt',
        'variant_type',
        'genome_build'
      ])
      expect(pk(db, 'gene_burden_summary')).toEqual(['gene_symbol', 'genome_build'])
      expect(() => service.cohortSummary.rebuild()).not.toThrow()
      const rows = db
        .prepare('SELECT chr, variant_type, genome_build FROM cohort_variant_summary ORDER BY 1, 2')
        .all()
      expect(rows).toEqual([
        { chr: '1', variant_type: 'indel', genome_build: 'GRCh37' },
        { chr: 'chr1', variant_type: 'indel', genome_build: 'GRCh38' },
        { chr: 'chr1', variant_type: 'sv', genome_build: 'GRCh38' }
      ])
      // Right keys: nothing to repair on the next open.
      expect(repairSummaryKeys(db)).toEqual([])
    } finally {
      service.close()
    }
  })
})
