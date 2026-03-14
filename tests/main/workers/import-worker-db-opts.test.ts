// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unlinkSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { initializeSchema } from '../../../src/main/database/schema'

describe('import worker DB optimizations', () => {
  let db: DatabaseType
  let dbPath: string

  beforeEach(() => {
    dbPath = join(tmpdir(), `varlens-test-${randomUUID()}.db`)
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    initializeSchema(db)
  })

  afterEach(() => {
    try {
      db.close()
    } catch {
      // already closed
    }
    try {
      unlinkSync(dbPath)
      unlinkSync(dbPath + '-wal')
      unlinkSync(dbPath + '-shm')
    } catch {
      // best effort
    }
  })

  it('indexes can be dropped and recreated idempotently', () => {
    // Verify indexes exist after schema init
    const indexesBefore = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
      .all() as { name: string }[]
    const indexNamesBefore = indexesBefore.map((i) => i.name)

    expect(indexNamesBefore).toContain('idx_variants_gene')
    expect(indexNamesBefore).toContain('idx_vt_selected')

    // Drop non-essential indexes (simulating import start)
    // Note: only tests 6 schema indexes. The 3 migration indexes
    // (filter_covering, case_coords, gene_notnull) are not created by
    // initializeSchema() — they require running the migration runner.
    db.exec(`
      DROP INDEX IF EXISTS idx_variants_gene;
      DROP INDEX IF EXISTS idx_variants_pos;
      DROP INDEX IF EXISTS idx_variants_filters;
      DROP INDEX IF EXISTS idx_variants_chr_pos_ref_alt;
      DROP INDEX IF EXISTS idx_vt_selected;
      DROP INDEX IF EXISTS idx_vt_transcript;
    `)

    // Verify they're gone
    const indexesAfterDrop = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
      .all() as { name: string }[]
    const droppedNames = indexesAfterDrop.map((i) => i.name)

    expect(droppedNames).not.toContain('idx_variants_gene')
    expect(droppedNames).toContain('idx_variants_case_id') // kept
    expect(droppedNames).toContain('idx_vt_variant_id') // kept

    // Recreate indexes (simulating import end)
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_variants_gene ON variants(gene_symbol);
      CREATE INDEX IF NOT EXISTS idx_variants_pos ON variants(chr, pos);
      CREATE INDEX IF NOT EXISTS idx_variants_filters ON variants(gnomad_af, cadd);
      CREATE INDEX IF NOT EXISTS idx_variants_chr_pos_ref_alt ON variants(chr, pos, ref, alt);
      CREATE INDEX IF NOT EXISTS idx_vt_selected ON variant_transcripts(variant_id, is_selected);
      CREATE INDEX IF NOT EXISTS idx_vt_transcript ON variant_transcripts(transcript_id);
    `)

    // Verify they're back
    const indexesAfterRecreate = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
      .all() as { name: string }[]
    const recreatedNames = indexesAfterRecreate.map((i) => i.name)

    expect(recreatedNames).toContain('idx_variants_gene')
    expect(recreatedNames).toContain('idx_vt_selected')
  })

  it('WAL checkpoint TRUNCATE resets WAL file', () => {
    // Insert some data to create WAL entries
    db.exec(`
      INSERT INTO cases (name, file_path, file_size, variant_count, created_at)
      VALUES ('test', '/test', 100, 0, ${Date.now()})
    `)

    // Checkpoint
    const result = db.pragma('wal_checkpoint(TRUNCATE)') as {
      busy: number
      checkpointed: number
      log: number
    }[]
    expect(result[0].busy).toBe(0)
  })

  it('synchronous=OFF and foreign_keys=OFF can be set per connection', () => {
    // Open a second connection (simulating import worker)
    const workerDb = new Database(dbPath)
    workerDb.pragma('synchronous = OFF')
    workerDb.pragma('foreign_keys = OFF')

    const syncResult = workerDb.pragma('synchronous') as { synchronous: number }[]
    expect(syncResult[0].synchronous).toBe(0) // OFF = 0

    const fkResult = workerDb.pragma('foreign_keys') as { foreign_keys: number }[]
    expect(fkResult[0].foreign_keys).toBe(0) // OFF = 0

    // Original connection should still have its own settings
    const origSync = db.pragma('synchronous') as { synchronous: number }[]
    expect(origSync[0].synchronous).toBe(1) // NORMAL = 1

    workerDb.close()
  })
})
