// @vitest-environment node
/**
 * Session end of the SQLite import worker: the planner statistics must cover
 * the indexes the session dropped for the bulk insert, and the write-ahead log
 * must not be left to grow with every file.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'

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

  const fileFor = (name: string, variants: number, filler = ''): string => {
    const path = join(dir, `${name}.json`)
    const rows = Array.from({ length: variants }, (_, i) => ({
      chr: 'chr1',
      pos: 1000 + i,
      ref: 'A',
      alt: 'G',
      gene_symbol: `GENE${i % 50}`,
      gt_num: '0/1',
      consequence: 'MODERATE',
      func: 'missense_variant',
      cdna: `c.${i}A>G${filler}`
    }))
    writeFileSync(path, JSON.stringify({ variants: rows }))
    return path
  }

  async function runSession(
    files: StartMessage['files'],
    onFileComplete: () => void = () => undefined
  ): Promise<WorkerMessage[]> {
    const messages: WorkerMessage[] = []
    await runImportSession(
      { type: 'start', files, dbPath } as StartMessage,
      {
        postMessage: (m) => {
          messages.push(m)
          if (m.type === 'file-complete') onFileComplete()
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

  it('checkpoints between files so the WAL stays bounded', async () => {
    // A few MiB of WAL per file.
    const filler = 'x'.repeat(600)
    const files = ['A', 'B', 'C', 'D', 'E', 'F'].map((name) => ({
      filePath: fileFor(name, 3000, filler),
      caseName: name
    })) as StartMessage['files']

    const walSizes: number[] = []
    await runSession(files, () => walSizes.push(statSync(`${dbPath}-wal`).size))

    expect(walSizes).toHaveLength(files.length)
    expect(walSizes[0]).toBeGreaterThan(1024 * 1024)
    // Without checkpoints the log grows by at least one file's pages per file
    // (6x the first file here); with them it is overwritten from the start.
    expect(Math.max(...walSizes)).toBeLessThan(walSizes[0] * 3)
  })
})
