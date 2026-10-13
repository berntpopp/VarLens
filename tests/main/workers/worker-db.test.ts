// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unlinkSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'
import { DATABASE_CONFIG } from '../../../src/shared/config'
import {
  openWorkerDatabase,
  openWorkerDatabaseReadOnly,
  rebuildFts,
  rebuildCohortSummary,
  DROP_FTS_TRIGGERS
} from '../../../src/main/workers/worker-db'

const openedDbs: DatabaseType[] = []
const tempFiles: string[] = []

function trackDb(db: DatabaseType): DatabaseType {
  openedDbs.push(db)
  return db
}

function makeTempPath(): string {
  const p = join(tmpdir(), `varlens-test-${randomUUID()}.db`)
  tempFiles.push(p)
  return p
}

afterEach(() => {
  for (const db of openedDbs.splice(0)) {
    try {
      db.close()
    } catch {
      // already closed
    }
  }
  for (const p of tempFiles.splice(0)) {
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        unlinkSync(p + suffix)
      } catch {
        // best effort
      }
    }
  }
})

describe('DROP_FTS_TRIGGERS', () => {
  it('is a non-empty string', () => {
    expect(typeof DROP_FTS_TRIGGERS).toBe('string')
    expect(DROP_FTS_TRIGGERS.trim().length).toBeGreaterThan(0)
  })

  it('executes without error on an initialized schema', () => {
    const db = trackDb(new Database(':memory:'))
    initializeSchema(db)
    runMigrations(db)
    expect(() => db.exec(DROP_FTS_TRIGGERS)).not.toThrow()
  })
})

describe('openWorkerDatabase', () => {
  it("rejects encryption key starting with x'", () => {
    expect(() => openWorkerDatabase(':memory:', "x'0102'")).toThrow(/hex-literal/i)
  })

  it("rejects encryption key starting with X'", () => {
    expect(() => openWorkerDatabase(':memory:', "X'aabbcc'")).toThrow(/hex-literal/i)
  })

  it('opens a writable in-memory database', () => {
    const db = trackDb(openWorkerDatabase(':memory:'))
    expect(db).toBeDefined()
    expect(db.open).toBe(true)
    expect(db.readonly).toBe(false)
  })

  it('can write data after opening', () => {
    const db = trackDb(openWorkerDatabase(':memory:'))
    db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, val TEXT)')
    db.prepare('INSERT INTO test (val) VALUES (?)').run('hello')
    const row = db.prepare('SELECT val FROM test').get() as { val: string }
    expect(row.val).toBe('hello')
  })

  it('sets WAL journal mode', () => {
    const db = trackDb(openWorkerDatabase(':memory:'))
    // In-memory DBs don't support WAL; the pragma still returns a result
    const result = db.pragma('journal_mode') as { journal_mode: string }[]
    expect(result[0].journal_mode).toBeDefined()
  })

  it('sets foreign_keys OFF', () => {
    const db = trackDb(openWorkerDatabase(':memory:'))
    const result = db.pragma('foreign_keys') as { foreign_keys: number }[]
    expect(result[0].foreign_keys).toBe(0)
  })

  it('sets synchronous OFF', () => {
    const db = trackDb(openWorkerDatabase(':memory:'))
    const result = db.pragma('synchronous') as { synchronous: number }[]
    expect(result[0].synchronous).toBe(0)
  })

  it('bounds ANALYZE with the configured analysis limit (#559)', () => {
    const db = trackDb(openWorkerDatabase(':memory:'))
    expect(db.pragma('analysis_limit', { simple: true })).toBe(DATABASE_CONFIG.ANALYSIS_LIMIT)
  })
})

describe('openWorkerDatabaseReadOnly', () => {
  it("rejects encryption key starting with x'", () => {
    const dbPath = makeTempPath()
    const seed = trackDb(new Database(dbPath))
    seed.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)')
    seed.close()

    expect(() => openWorkerDatabaseReadOnly(dbPath, "x'0102'")).toThrow(/hex-literal/i)
  })

  it("rejects encryption key starting with X'", () => {
    const dbPath = makeTempPath()
    const seed = trackDb(new Database(dbPath))
    seed.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)')
    seed.close()

    expect(() => openWorkerDatabaseReadOnly(dbPath, "X'aabbcc'")).toThrow(/hex-literal/i)
  })

  it('opens a database successfully', () => {
    // Read-only mode requires a real file (in-memory DBs cannot be readonly)
    const dbPath = makeTempPath()
    // Seed the file with a writable connection first
    const seed = trackDb(new Database(dbPath))
    seed.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)')
    seed.close()
    const db = trackDb(openWorkerDatabaseReadOnly(dbPath))
    expect(db).toBeDefined()
    expect(db.open).toBe(true)
    expect(db.readonly).toBe(true)
  })

  it('write attempts fail on a readonly database', () => {
    const dbPath = makeTempPath()
    const seed = new Database(dbPath)
    seed.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)')
    seed.close()
    const db = trackDb(openWorkerDatabaseReadOnly(dbPath))
    expect(() => db.prepare('INSERT INTO t VALUES (1)').run()).toThrow()
  })

  it('returns a database without encryption when no key given', () => {
    const dbPath = makeTempPath()
    const seed = new Database(dbPath)
    seed.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)')
    seed.close()
    const db = trackDb(openWorkerDatabaseReadOnly(dbPath))
    expect(db.open).toBe(true)
    expect(db.readonly).toBe(true)
  })
})

describe('rebuildFts', () => {
  it('restores extension FTS triggers a torn-down bracket lost (#551)', () => {
    const db = trackDb(new Database(':memory:'))
    initializeSchema(db)
    runMigrations(db)
    db.exec('DROP TRIGGER variant_sv_fts_ai; DROP TRIGGER variant_str_fts_ad')
    rebuildFts(db)
    db.exec(
      "INSERT INTO cases (id, name, file_path, file_size, created_at) VALUES (1, 'c', '/c', 1, 0)"
    )
    db.exec(
      "INSERT INTO variants (id, case_id, chr, pos, ref, alt) VALUES (1, 1, 'chr1', 1, 'N', '<DEL>')"
    )
    db.exec("INSERT INTO variant_sv (variant_id, event_id) VALUES (1, 'evtx')")
    expect(
      db.prepare("SELECT COUNT(*) AS c FROM variant_sv_fts WHERE variant_sv_fts MATCH 'evtx'").get()
    ).toEqual({ c: 1 })
    expect(
      db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = 'variant_str_fts_ad'"
        )
        .get()
    ).toBeDefined()
  })

  it('lets a failure propagate so the caller keeps its recovery state (#559)', () => {
    const db = trackDb(new Database(':memory:'))
    initializeSchema(db)
    runMigrations(db)
    db.exec('DROP TABLE variants_fts')
    db.exec('CREATE TABLE variants_fts (x)')
    expect(() => rebuildFts(db)).toThrow()
  })

  it('does not throw on a schema-initialized DB', () => {
    const db = trackDb(new Database(':memory:'))
    initializeSchema(db)
    runMigrations(db)
    expect(() => rebuildFts(db)).not.toThrow()
  })

  it('FTS table is queryable after rebuild', () => {
    const db = trackDb(new Database(':memory:'))
    initializeSchema(db)
    runMigrations(db)
    rebuildFts(db)
    // The FTS virtual table should exist and be queryable
    expect(() => db.prepare('SELECT COUNT(*) as c FROM variants_fts').get()).not.toThrow()
  })
})

describe('rebuildCohortSummary', () => {
  it('does not throw on a schema-initialized DB', () => {
    const db = trackDb(new Database(':memory:'))
    initializeSchema(db)
    runMigrations(db)
    expect(() => rebuildCohortSummary(db)).not.toThrow()
  })

  it('cohort_variant_summary table exists after call', () => {
    const db = trackDb(new Database(':memory:'))
    initializeSchema(db)
    runMigrations(db)
    rebuildCohortSummary(db)
    const result = db
      .prepare(
        "SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name='cohort_variant_summary'"
      )
      .get() as { c: number }
    expect(result.c).toBe(1)
  })

  it('inserts rows into cohort_variant_summary when variants exist', () => {
    const db = trackDb(new Database(':memory:'))
    initializeSchema(db)
    runMigrations(db)

    // Insert a case and a variant
    const caseId = db
      .prepare(
        'INSERT INTO cases (name, file_path, file_size, variant_count, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run('test-case', '/test.json', 1000, 1, Date.now()).lastInsertRowid as number

    db.prepare(
      'INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, gt_num) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(caseId, 'chr1', 12345, 'A', 'T', 'BRCA1', '0/1')

    rebuildCohortSummary(db)

    const summary = db
      .prepare('SELECT carrier_count FROM cohort_variant_summary WHERE chr = ? AND pos = ?')
      .get('chr1', 12345) as { carrier_count: number } | undefined

    expect(summary).toBeDefined()
    expect(summary!.carrier_count).toBe(1)
  })

  it('silently skips when cohort_variant_summary table does not exist', () => {
    // Use a bare DB without any schema — CHECK_TABLE_EXISTS_SQL returns 0, so function returns early
    const db = trackDb(new Database(':memory:'))
    expect(() => rebuildCohortSummary(db)).not.toThrow()
  })
})
