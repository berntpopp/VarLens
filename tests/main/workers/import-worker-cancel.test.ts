// @vitest-environment node
/**
 * Mid-file cancellation of an import session through the `isCancelled`
 * function the caller injects into `runImportSession` (the worker entry point
 * passes its message-driven flag; tests and other hosts pass their own).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'
import { runImportSession, type ImportWorkerPort } from '../../../src/main/workers/import-worker'
import type { WorkerMessage } from '../../../src/shared/types/import-worker'

const TOTAL_VARIANTS = 2_000
const BATCH_SIZE = 100

describe('import session cancellation via the injected isCancelled', () => {
  let dir: string
  let dbPath: string
  let filePath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'varlens-import-cancel-'))
    dbPath = join(dir, 'import.db')
    const db = new Database(dbPath)
    initializeSchema(db)
    runMigrations(db)
    db.close()

    filePath = join(dir, 'many.json')
    writeFileSync(
      filePath,
      JSON.stringify({
        variants: Array.from({ length: TOTAL_VARIANTS }, (_, i) => ({
          chr: 'chr1',
          pos: 1_000 + i,
          ref: 'A',
          alt: 'C',
          gene_symbol: `GENE${i}`,
          consequence: 'MODERATE'
        }))
      })
    )
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  /** Run one import that the caller cancels as soon as the first batch is in. */
  async function importCancelledAfterFirstBatch(): Promise<WorkerMessage[]> {
    const messages: WorkerMessage[] = []
    let cancelRequested = false
    const port: ImportWorkerPort = {
      postMessage: (message) => {
        messages.push(message)
        if (message.type === 'progress' && message.phase === 'inserting') cancelRequested = true
      }
    }
    await runImportSession(
      {
        type: 'start',
        dbPath,
        throttleMs: 0,
        batchSize: BATCH_SIZE,
        files: [
          { filePath, caseName: 'cancelled-case', isDuplicate: false, duplicateStrategy: 'skip' },
          { filePath, caseName: 'never-started', isDuplicate: false, duplicateStrategy: 'skip' }
        ]
      },
      port,
      () => cancelRequested
    )
    return messages
  }

  it('stops inserting in the middle of the file', async () => {
    const messages = await importCancelledAfterFirstBatch()

    const inserted = messages.flatMap((message) =>
      message.type === 'progress' && message.phase === 'inserting' ? [message.variantCount] : []
    )
    expect(inserted.length).toBeGreaterThan(0)
    // Without the injected function reaching the streaming loop the whole
    // file is inserted before the cancellation is noticed.
    expect(Math.max(...inserted)).toBeLessThan(TOTAL_VARIANTS)

    const complete = messages.find((message) => message.type === 'complete')
    expect(complete?.type === 'complete' && complete.results.cancelled).toBe(true)
  })
})
