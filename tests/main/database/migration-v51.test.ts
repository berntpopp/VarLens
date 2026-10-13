/**
 * Migration v51 (mirrors PG 0034): import integrity. A fresh database and one
 * upgraded from v49 end in the same state.
 */
import Database from 'better-sqlite3-multiple-ciphers'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AnnotationRepository } from '../../../src/main/database/AnnotationRepository'
import { createKysely } from '../../../src/main/database/kysely'
import { LATEST_SQLITE_SCHEMA_VERSION, runMigrations } from '../../../src/main/database/migrations'
import { initializeSchema } from '../../../src/main/database/schema'

describe('migration v51: import integrity', () => {
  let db: InstanceType<typeof Database>

  beforeEach(() => {
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
  })

  afterEach(() => db.close())

  const hasObject = (type: string, name: string): boolean =>
    db.prepare('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?').get(type, name) !==
    undefined

  /** Put the database back to v49 as the previous release left it. */
  function backToV49(): void {
    db.exec(`
      CREATE TABLE variant_frequency (
        chr TEXT NOT NULL, pos INTEGER NOT NULL, ref TEXT NOT NULL, alt TEXT NOT NULL,
        case_count INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (chr, pos, ref, alt)
      );
      INSERT INTO variant_frequency VALUES ('chr1', 100, 'A', 'G', 3);
      CREATE INDEX idx_variants_coords ON variants(chr, pos, ref, alt);
      INSERT INTO cases (id, name, file_path, file_size, variant_count, created_at)
        VALUES (1, 'drifted', '/d', 1, 7, 0), (2, 'empty', '/e', 1, 3, 0);
      INSERT INTO variants (case_id, chr, pos, ref, alt) VALUES
        (1, 'chr1', 1, 'A', 'G'), (1, 'chr1', 2, 'A', 'G');
      PRAGMA user_version = 49;
    `)
  }

  it('is the latest schema version', () => {
    expect(LATEST_SQLITE_SCHEMA_VERSION).toBe(51)
    expect(db.pragma('user_version', { simple: true })).toBe(51)
  })

  /** Indexes on variants over exactly (chr, pos, ref, alt). */
  const coordinateIndexes = (): string[] =>
    (db.prepare("PRAGMA index_list('variants')").all() as { name: string }[])
      .map((i) => i.name)
      .filter(
        (name) =>
          (db.prepare(`PRAGMA index_info('${name}')`).all() as { name: string }[])
            .map((c) => c.name)
            .join(',') === 'chr,pos,ref,alt'
      )

  it('a new database has one coordinate index (#564)', () => {
    expect(coordinateIndexes()).toEqual(['idx_variants_chr_pos_ref_alt'])
  })

  it('an upgraded database keeps one coordinate index (#564)', () => {
    backToV49()
    expect(coordinateIndexes()).toHaveLength(2)
    runMigrations(db)
    expect(coordinateIndexes()).toEqual(['idx_variants_chr_pos_ref_alt'])
  })

  it('an upgraded database has every variant_count recounted (#560)', () => {
    backToV49()
    runMigrations(db)
    expect(db.prepare('SELECT id, variant_count FROM cases ORDER BY id').all()).toEqual([
      { id: 1, variant_count: 2 },
      { id: 2, variant_count: 0 }
    ])
  })

  it('the annotation batch lookup stays indexed (#564)', () => {
    const statements: string[] = []
    const kysely = createKysely(db)
    const realPrepare = db.prepare.bind(db)
    const spy = ((sql: string) => {
      statements.push(sql)
      return realPrepare(sql)
    }) as typeof db.prepare
    db.prepare = spy
    new AnnotationRepository(db, kysely).getBatch(1, [
      { chr: 'chr1', pos: 1, ref: 'A', alt: 'G', variantId: 1 }
    ])
    db.prepare = realPrepare
    expect(statements).toHaveLength(2)
    const params = [
      ['chr1', 1, 'A', 'G'],
      [1, 1, 'chr1', 1, 'A', 'G', 1]
    ]
    statements.forEach((sql, i) => {
      const plan = (
        realPrepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params[i]) as { detail: string }[]
      ).map((r) => r.detail)
      // A full scan of a table, not an index search.
      expect(plan.filter((d) => /^SCAN \w+$/.test(d))).toEqual([])
    })
  })

  it('a new database has no variant_frequency table (#595)', () => {
    expect(hasObject('table', 'variant_frequency')).toBe(false)
  })

  it('an upgraded database loses variant_frequency (#595)', () => {
    backToV49()
    runMigrations(db)
    expect(hasObject('table', 'variant_frequency')).toBe(false)
    expect(db.pragma('user_version', { simple: true })).toBe(51)
  })
})
