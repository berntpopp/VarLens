// @vitest-environment node
/**
 * Issue #445, SQLite import worker session: batchSize validation, the
 * `case-started` announcement the client relies on, and the recovery run
 * that discards a case a dead worker left half-written.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { initializeSchema } from '../../../src/main/database/schema'
import { runMigrations } from '../../../src/main/database/migrations'
import { openWorkerDatabase } from '../../../src/main/workers/worker-db'
import { DROP_INDEXES, prepareStatements } from '../../../src/main/workers/import-pipeline'
import { DROP_FTS_TRIGGERS } from '../../../src/main/workers/worker-db'
import { runImportSession } from '../../../src/main/workers/import-worker'
import { ErrorCode } from '../../../src/shared/types/errors'
import type { MainMessage, WorkerMessage } from '../../../src/shared/types/import-worker'

type StartMessage = Extract<MainMessage, { type: 'start' }>

describe('import worker session guards', () => {
  let tmpDir: string
  let dbPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'varlens-session-guards-'))
    dbPath = join(tmpDir, 'test.db')
    const db = new Database(dbPath)
    initializeSchema(db)
    runMigrations(db)
    db.close()
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  async function run(start: Partial<StartMessage>): Promise<WorkerMessage[]> {
    const messages: WorkerMessage[] = []
    await runImportSession(
      { type: 'start', dbPath, files: [], throttleMs: 0, ...start },
      { postMessage: (m) => messages.push(m) }
    )
    return messages
  }

  function writeSimpleJson(): string {
    const filePath = join(tmpDir, 'case.json')
    writeFileSync(
      filePath,
      JSON.stringify({ variants: [{ chr: '1', pos: 100, ref: 'A', alt: 'T', gene_symbol: 'G1' }] })
    )
    return filePath
  }

  function triggerNames(): string[] {
    const db = new Database(dbPath, { readonly: true })
    const rows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'variants_fts_%'"
      )
      .all() as Array<{ name: string }>
    db.close()
    return rows.map((r) => r.name).sort()
  }

  it.each([0, -1, 1.5, 50_001, Number.NaN, '100' as unknown as number])(
    'rejects batchSize %p as a typed fatal error before touching the database',
    async (batchSize) => {
      const before = triggerNames()
      const messages = await run({
        batchSize,
        files: [
          {
            filePath: writeSimpleJson(),
            caseName: 'never-created',
            isDuplicate: false,
            duplicateStrategy: 'skip'
          }
        ]
      })

      expect(messages).toHaveLength(1)
      const [fatal] = messages
      expect(fatal).toMatchObject({
        type: 'error',
        fileIndex: -1,
        phase: 'fatal',
        errorCode: ErrorCode.INVALID_PARAMETERS
      })
      expect((fatal as { error: string }).error).toMatch(/batchSize must be an integer/)

      const db = new Database(dbPath, { readonly: true })
      expect(db.prepare('SELECT COUNT(*) AS c FROM cases').get()).toEqual({ c: 0 })
      db.close()
      // The session never started, so the FTS triggers were not dropped.
      expect(triggerNames()).toEqual(before)
    }
  )

  it.each([1, 50_000])('accepts batchSize %p', async (batchSize) => {
    const messages = await run({
      batchSize,
      files: [
        {
          filePath: writeSimpleJson(),
          caseName: 'ok',
          isDuplicate: false,
          duplicateStrategy: 'skip'
        }
      ]
    })

    const complete = messages.find((m) => m.type === 'complete')
    expect(complete).toMatchObject({ results: { succeeded: 1, failed: 0 } })
  })

  it('announces the case before inserting, then reports the file complete', async () => {
    const messages = await run({
      files: [
        {
          filePath: writeSimpleJson(),
          caseName: 'announced',
          isDuplicate: false,
          duplicateStrategy: 'skip'
        }
      ]
    })

    const started = messages.findIndex((m) => m.type === 'case-started')
    const completed = messages.findIndex((m) => m.type === 'file-complete')
    expect(started).toBeGreaterThanOrEqual(0)
    expect(completed).toBeGreaterThan(started)
    const startedMsg = messages[started] as Extract<WorkerMessage, { type: 'case-started' }>
    const completedMsg = messages[completed] as Extract<WorkerMessage, { type: 'file-complete' }>
    expect(startedMsg.caseId).toBe(completedMsg.result.caseId)
  })

  it('recovery run discards a partial case and restores FTS triggers and indexes', async () => {
    // Reproduce what a worker killed at its heap limit leaves behind: a
    // committed batch of a case, FTS triggers and import indexes dropped.
    const dead = openWorkerDatabase(dbPath)
    const stmts = prepareStatements(dead)
    const triggersBefore = triggerNames()
    const keptId = Number(
      stmts.insertCase.run('kept', '/kept', 1, Date.now(), 'GRCh38').lastInsertRowid
    )
    stmts.insertBatch(keptId, [{ chr: '1', pos: 1, ref: 'A', alt: 'T' }])
    dead.exec(DROP_FTS_TRIGGERS)
    dead.exec(DROP_INDEXES)
    const partialId = Number(
      stmts.insertCase.run('partial', '/partial', 1, Date.now(), 'GRCh38').lastInsertRowid
    )
    stmts.insertBatch(partialId, [
      {
        chr: '2',
        pos: 2,
        ref: 'G',
        alt: 'C',
        _transcripts: [
          {
            transcript_id: 'T2',
            gene_symbol: 'G2',
            consequence: null,
            func: null,
            cdna: null,
            aa_change: null,
            hpo_sim_score: null,
            moi: null,
            is_selected: 1
          }
        ]
      }
    ])
    dead.close()
    expect(triggerNames()).toEqual([])

    const messages = await run({ files: [], discardCaseIds: [partialId] })

    expect(messages.at(-1)).toMatchObject({
      type: 'complete',
      results: { succeeded: 0, failed: 0, skipped: 0 }
    })
    const db = new Database(dbPath, { readonly: true })
    expect(db.prepare('SELECT name FROM cases ORDER BY id').all()).toEqual([{ name: 'kept' }])
    expect(db.prepare('SELECT COUNT(*) AS c FROM variants').get()).toEqual({ c: 1 })
    expect(db.prepare('SELECT COUNT(*) AS c FROM variant_transcripts').get()).toEqual({ c: 0 })
    db.close()
    expect(triggerNames()).toEqual(triggersBefore)
    expect(triggersBefore.length).toBeGreaterThan(0)
  })
})
