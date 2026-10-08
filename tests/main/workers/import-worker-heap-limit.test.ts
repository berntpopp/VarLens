// @vitest-environment node
/**
 * Issue #445: an import worker that hits its heap limit must fail the import
 * with a typed error, and leave this process (the Electron main process in
 * production) running.
 *
 * These tests start real worker threads with a 16 MB old-generation limit and
 * a script that allocates until V8 stops it, so the whole path is exercised:
 * `resourceLimits` on the Worker, `ERR_WORKER_OUT_OF_MEMORY`, the client's
 * mapping, the partial-case recovery run and the executor's rejection.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('../../../src/main/services/MainLogger', () => ({
  mainLogger: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} }
}))

import { ImportWorkerClient } from '../../../src/main/workers/import-worker-client'
import { PostgresImportWorkerClient } from '../../../src/main/storage/postgres/PostgresImportWorkerClient'
import { SqliteImportExecutor } from '../../../src/main/storage/sqlite/SqliteImportExecutor'
import { ImportResourceLimitError } from '../../../src/main/storage/import-worker-errors'
import { ErrorCode } from '../../../src/shared/types/errors'
import type { WorkerMessage } from '../../../src/shared/types/import-worker'
import type { PostgresImportWorkerErrorMessage } from '../../../src/shared/types/postgres-import-worker'

const TINY_HEAP = { maxOldGenerationSizeMb: 16 }
const PARTIAL_CASE_ID = 7

/**
 * A stand-in import worker. On `start` it reports a case as started when the
 * first file asks for it, then allocates until the heap limit stops it. A
 * recovery start (`discardCaseIds`) is answered like the real worker: it
 * records what it was asked to discard and completes.
 */
const HEAP_HOG_WORKER = `
const { parentPort } = require('node:worker_threads')
const { writeFileSync } = require('node:fs')
parentPort.on('message', (msg) => {
  if (msg.type !== 'start') return
  if (Array.isArray(msg.discardCaseIds)) {
    writeFileSync(msg.dbPath + '.discarded', JSON.stringify(msg.discardCaseIds))
    parentPort.postMessage({
      type: 'complete',
      results: { succeeded: 0, failed: 0, skipped: 0, cancelled: false, details: [] }
    })
    return
  }
  const first = msg.files && msg.files[0] && msg.files[0].caseName
  if (first === 'partial' || first === 'replacement') {
    parentPort.postMessage({
      type: 'case-started',
      fileIndex: 0,
      caseId: ${PARTIAL_CASE_ID},
      ...(first === 'replacement' ? { replacement: true } : {})
    })
  }
  const hog = []
  for (;;) hog.push(new Array(1000000).fill(1.5))
})
`

type ImportWorkerError = Extract<WorkerMessage, { type: 'error' }>

describe('import worker heap limit', () => {
  let tmpDir: string
  let workerPath: string
  let dbPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'varlens-heap-limit-'))
    workerPath = join(tmpDir, 'heap-hog-worker.cjs')
    dbPath = join(tmpDir, 'case.db')
    writeFileSync(workerPath, HEAP_HOG_WORKER)
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  function runSqliteClient(caseName: string): Promise<{
    error: ImportWorkerError
    client: ImportWorkerClient
  }> {
    const client = new ImportWorkerClient({ workerPath, resourceLimits: TINY_HEAP })
    return new Promise((resolve, reject) => {
      client.start({
        files: [{ filePath: '/x.json', caseName, isDuplicate: false, duplicateStrategy: 'skip' }],
        dbPath,
        throttleMs: 100,
        onProgress: () => {},
        onFileComplete: () => {},
        onComplete: () => reject(new Error('worker completed instead of hitting its heap limit')),
        onError: (error) => resolve({ error, client })
      })
    })
  }

  it('SQLite client reports a typed RESOURCE_LIMIT failure and stays usable', async () => {
    const { error, client } = await runSqliteClient('whole')

    expect(error.fileIndex).toBe(-1)
    expect(error.phase).toBe('worker')
    expect(error.errorCode).toBe(ErrorCode.RESOURCE_LIMIT)
    expect(error.error).toMatch(/memory budget/)
    expect(error.userMessage).toMatch(/ran out of memory/)
    expect(client.isRunning).toBe(false)
    // No case had been started, so there is nothing to discard.
    expect(existsSync(`${dbPath}.discarded`)).toBe(false)
  })

  it('SQLite client has the partial case discarded before it reports the failure', async () => {
    const { error, client } = await runSqliteClient('partial')

    expect(error.errorCode).toBe(ErrorCode.RESOURCE_LIMIT)
    // The recovery run finished before onError fired.
    expect(JSON.parse(readFileSync(`${dbPath}.discarded`, 'utf8'))).toEqual([PARTIAL_CASE_ID])
    expect(client.isRunning).toBe(false)
  })

  it('SQLite client does not name a replacement case for discarding', async () => {
    // It may already be published in place of the case it overwrote; recovery
    // still deletes it by itself while it is provisional.
    const { error } = await runSqliteClient('replacement')

    expect(error.errorCode).toBe(ErrorCode.RESOURCE_LIMIT)
    expect(JSON.parse(readFileSync(`${dbPath}.discarded`, 'utf8'))).toEqual([])
  })

  it('SQLite executor rejects the import with ImportResourceLimitError', async () => {
    const executor = new SqliteImportExecutor({
      getDatabaseService: () =>
        ({ getPath: () => dbPath, getEncryptionKey: () => undefined }) as never,
      createWorkerClient: () => new ImportWorkerClient({ workerPath, resourceLimits: TINY_HEAP })
    })

    const failure = await executor
      .importSingleFile({ filePath: '/x.json', caseName: 'whole', throttleMs: 100 })
      .then(
        () => null,
        (error: unknown) => error
      )

    expect(failure).toBeInstanceOf(ImportResourceLimitError)
    expect((failure as ImportResourceLimitError).code).toBe(ErrorCode.RESOURCE_LIMIT)
    expect((failure as ImportResourceLimitError).userMessage).toMatch(/ran out of memory/)
  })

  it('PostgreSQL client reports a typed RESOURCE_LIMIT failure', async () => {
    const client = new PostgresImportWorkerClient({
      workerPathCandidates: [workerPath],
      resourceLimits: TINY_HEAP
    })

    const error = await new Promise<PostgresImportWorkerErrorMessage>((resolve, reject) => {
      client.start(
        {
          type: 'start',
          client: { connectionString: 'postgres://unused' },
          schema: 'public',
          mode: 'single-file',
          caseName: 'whole',
          filePath: '/x.json'
        },
        {
          onProgress: () => {},
          onFileComplete: () => {},
          onComplete: () => reject(new Error('worker completed instead of hitting its heap limit')),
          onError: resolve
        }
      )
    })

    expect(error.code).toBe(ErrorCode.RESOURCE_LIMIT)
    expect(error.message).toMatch(/memory budget/)
    expect(error.userMessage).toMatch(/ran out of memory/)
  })
})
