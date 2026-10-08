// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'

import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'
import { runImportSession } from '../../../src/main/workers/import-worker'
import type { WorkerMessage } from '../../../src/shared/types/import-worker'

/** #495: a JSON row without a position is rejected and counted, not stored at position 0. */
describe('import worker JSON rows without required fields', () => {
  let dir: string
  let dbPath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'varlens-json-skips-'))
    dbPath = join(dir, 'test.db')
    const db = new Database(dbPath)
    initializeSchema(db)
    runMigrations(db)
    db.close()
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('rejects and counts them', async () => {
    const filePath = join(dir, 'case.json')
    writeFileSync(
      filePath,
      JSON.stringify({
        variants: [
          { chr: 'chr1', pos: 100, ref: 'A', alt: 'T' },
          { chr: 'chr1', ref: 'C', alt: 'G' },
          { chr: 'chr1', pos: 300, ref: 'G' }
        ]
      })
    )
    const messages: WorkerMessage[] = []
    await runImportSession(
      {
        type: 'start',
        dbPath,
        throttleMs: 0,
        files: [{ filePath, caseName: 'c', isDuplicate: false, duplicateStrategy: 'skip' }]
      },
      { postMessage: (m) => messages.push(m) }
    )

    const done = messages.find((m) => m.type === 'file-complete')
    expect(done?.type === 'file-complete' && done.result).toMatchObject({
      variantCount: 1,
      skipped: 2
    })
    expect(done?.type === 'file-complete' && done.result.skipReasons).toHaveLength(2)
    const db = new Database(dbPath)
    expect(db.prepare('SELECT pos FROM variants').all()).toEqual([{ pos: 100 }])
    db.close()
  })
})
