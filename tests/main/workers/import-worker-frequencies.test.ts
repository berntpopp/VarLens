/**
 * Internal allele-frequency upkeep now runs inside the import worker (audit
 * 05, M-1) instead of on the Electron main thread after the worker returns.
 * Drives the real (esbuild-bundled) import worker against a real database.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Worker } from 'node:worker_threads'
import { DatabaseService } from '../../../src/main/database/DatabaseService'
import type {
  FileImportRequest,
  MainMessage,
  WorkerMessage
} from '../../../src/shared/types/import-worker'
import { bundleWorker } from '../../utils/bundle-worker'

const VCF = resolve(process.cwd(), 'tests/test-data/vcf/single-sample.snpeff.vcf.gz')

function runImport(
  workerPath: string,
  dbPath: string,
  files: FileImportRequest[]
): Promise<Extract<WorkerMessage, { type: 'complete' }>> {
  return new Promise((resolvePromise, reject) => {
    const worker = new Worker(workerPath)
    worker.on('message', (msg: WorkerMessage) => {
      if (msg.type === 'complete') {
        void worker.terminate()
        resolvePromise(msg)
      } else if (msg.type === 'error' && msg.fileIndex === -1) {
        void worker.terminate()
        reject(new Error(msg.error))
      }
    })
    worker.on('error', reject)
    worker.postMessage({ type: 'start', files, dbPath, throttleMs: 1000 } satisfies MainMessage)
  })
}

describe('import worker frequency upkeep', () => {
  let workerPath: string
  let dir: string
  let db: DatabaseService

  beforeAll(async () => {
    workerPath = await bundleWorker('src/main/workers/import-worker.ts')
  }, 60_000)

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'varlens-import-freq-'))
    db = new DatabaseService(join(dir, 'test.db'))
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const maxCaseCount = (): number =>
    (
      db.database.prepare('SELECT MAX(case_count) AS m FROM variant_frequency').get() as {
        m: number | null
      }
    ).m ?? 0

  const distinctCoords = (): number =>
    (
      db.database
        .prepare('SELECT COUNT(*) AS c FROM (SELECT DISTINCT chr, pos, ref, alt FROM variants)')
        .get() as { c: number }
    ).c

  it('counts each imported case once per coordinate, and replacing a case does not double count', async () => {
    const file = (caseName: string, isDuplicate = false): FileImportRequest => ({
      filePath: VCF,
      caseName,
      isDuplicate,
      duplicateStrategy: 'overwrite'
    })

    const first = await runImport(workerPath, db.getPath(), [file('a'), file('b')])
    expect(first.results.succeeded).toBe(2)
    expect(maxCaseCount()).toBe(2)
    const rows = db.database.prepare('SELECT COUNT(*) AS c FROM variant_frequency').get() as {
      c: number
    }
    expect(rows.c).toBe(distinctCoords())

    // Overwrite case "a": the old contribution is decremented before delete.
    const replaced = await runImport(workerPath, db.getPath(), [file('a', true)])
    expect(replaced.results.succeeded).toBe(1)
    expect(maxCaseCount()).toBe(2)
  }, 60_000)
})
