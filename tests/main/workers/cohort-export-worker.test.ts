/**
 * Cohort XLSX export runs in the export worker (audit 05, M-3): query,
 * workbook build and write happen off the main thread, with progress and
 * cancellation. Uses the real bundled import + export workers.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Worker } from 'node:worker_threads'
import * as XLSX from 'xlsx'
import { DatabaseService } from '../../../src/main/database/DatabaseService'
import { ExportWorkerClient } from '../../../src/main/workers/export-worker-client'
import type { MainMessage, WorkerMessage } from '../../../src/shared/types/import-worker'
import { bundleWorker } from '../../utils/bundle-worker'

const VCF = resolve(process.cwd(), 'tests/test-data/vcf/single-sample.snpeff.vcf.gz')

function importCases(workerPath: string, dbPath: string, names: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const worker = new Worker(workerPath)
    worker.on('message', (msg: WorkerMessage) => {
      if (msg.type === 'complete') {
        void worker.terminate()
        resolvePromise()
      } else if (msg.type === 'error' && msg.fileIndex === -1) {
        void worker.terminate()
        reject(new Error(msg.error))
      }
    })
    worker.postMessage({
      type: 'start',
      files: names.map((caseName) => ({
        filePath: VCF,
        caseName,
        isDuplicate: false,
        duplicateStrategy: 'skip' as const
      })),
      dbPath,
      throttleMs: 1000
    } satisfies MainMessage)
  })
}

describe('cohort export worker', () => {
  let importWorker: string
  let exportWorker: string
  let dir: string
  let db: DatabaseService

  beforeAll(async () => {
    importWorker = await bundleWorker('src/main/workers/import-worker.ts')
    exportWorker = await bundleWorker('src/main/workers/export-worker.ts')
  }, 60_000)

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'varlens-cohort-export-'))
    db = new DatabaseService(join(dir, 'test.db'))
    await importCases(importWorker, db.getPath(), ['a', 'b'])
  }, 60_000)

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes the workbook in the worker and reports progress', async () => {
    const outputFilePath = join(dir, 'cohort.xlsx')
    const progress: Array<[number, number]> = []

    const rowCount = await new Promise<number>((resolvePromise, reject) => {
      new ExportWorkerClient(exportWorker).startCohort({
        dbPath: db.getPath(),
        params: { genome_build: 'GRCh38' } as never,
        outputFilePath,
        onProgress: (current, total) => progress.push([current, total]),
        onComplete: (_filePath, rows) => resolvePromise(rows),
        onError: (error) => reject(new Error(error))
      })
    })

    expect(rowCount).toBeGreaterThan(0)
    expect(existsSync(outputFilePath)).toBe(true)
    const workbook = XLSX.read(readFileSync(outputFilePath))
    expect(workbook.SheetNames).toEqual(['Cohort Variants', 'Export Info'])
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets['Cohort Variants'])
    expect(rows).toHaveLength(rowCount)
    expect(progress[0]).toEqual([0, 0])
    expect(progress.at(-1)).toEqual([rowCount, rowCount])
  })

  it('cancels by terminating the worker and reports cancellation instead of completion', async () => {
    const outcome = await new Promise<string>((resolvePromise) => {
      const client = new ExportWorkerClient(exportWorker)
      client.startCohort({
        dbPath: db.getPath(),
        params: { genome_build: 'GRCh38' } as never,
        outputFilePath: join(dir, 'cancelled.xlsx'),
        onProgress: () => undefined,
        onComplete: () => resolvePromise('complete'),
        onError: (error) => resolvePromise(`error:${error}`),
        onCancelled: () => resolvePromise('cancelled')
      })
      client.cancel()
      expect(client.isRunning).toBe(false)
    })

    expect(outcome).toBe('cancelled')
  })
})
