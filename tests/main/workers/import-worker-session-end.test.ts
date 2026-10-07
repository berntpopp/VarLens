// @vitest-environment node
/**
 * Session end of the SQLite import worker: the planner statistics must cover
 * the indexes the session dropped for the bulk insert.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'

import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'
import { runImportSession } from '../../../src/main/workers/import-worker'
import type { MainMessage, WorkerMessage } from '../../../src/shared/types/import-worker'

type StartMessage = Extract<MainMessage, { type: 'start' }>

/** The indexes DROP_INDEXES removes for the session (import-index-sql.ts). */
const SESSION_INDEXES = [
  'idx_variants_gene',
  'idx_variants_pos',
  'idx_variants_filters',
  'idx_variants_chr_pos_ref_alt',
  'idx_variants_filter_covering',
  'idx_variants_case_coords',
  'idx_variants_gene_notnull',
  'idx_variants_case_chr_rank'
]

describe('import worker: session end', () => {
  let dir: string
  let dbPath: string
  let db: DatabaseType

  const fileFor = (name: string, variants: number): string => {
    const path = join(dir, `${name}.json`)
    const rows = Array.from({ length: variants }, (_, i) => ({
      chr: 'chr1',
      pos: 1000 + i,
      ref: 'A',
      alt: 'G',
      gene_symbol: `GENE${i % 50}`,
      gt_num: '0/1',
      consequence: 'MODERATE',
      func: 'missense_variant'
    }))
    writeFileSync(path, JSON.stringify({ variants: rows }))
    return path
  }

  async function runSession(files: StartMessage['files']): Promise<WorkerMessage[]> {
    const messages: WorkerMessage[] = []
    await runImportSession(
      { type: 'start', files, dbPath } as StartMessage,
      {
        postMessage: (m) => {
          messages.push(m)
        }
      },
      () => false
    )
    return messages
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'varlens-session-end-'))
    dbPath = join(dir, 'test.db')
    db = new Database(dbPath)
    initializeSchema(db)
    runMigrations(db)
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('gathers planner statistics for the indexes it recreated', async () => {
    const messages = await runSession([
      { filePath: fileFor('A', 200), caseName: 'A' },
      { filePath: fileFor('B', 200), caseName: 'B' }
    ] as StartMessage['files'])
    expect(messages.some((m) => m.type === 'complete')).toBe(true)

    const analysed = new Set(
      (
        db.prepare(`SELECT idx FROM sqlite_stat1 WHERE tbl = 'variants'`).all() as { idx: string }[]
      ).map((r) => r.idx)
    )
    for (const index of SESSION_INDEXES) expect(analysed, index).toContain(index)
  })
})
