/**
 * Main-thread blocking benchmark — audit 05 roadmap PR 8 (desktop half).
 *
 * Gated by VARLENS_RUN_MAIN_BLOCKING_PERF=1. For each operation it records
 * how long the *calling* thread's event loop was blocked (the Electron main
 * thread in the app) — max heartbeat gap, `monitorEventLoopDelay` max/p99
 * and the number of >50 ms stalls — once with the pre-PR code path executed
 * inline (exactly what used to run on the main thread) and once through the
 * new worker path.
 *
 *   VARLENS_RUN_MAIN_BLOCKING_PERF=1 npx vitest run --project perf \
 *     tests/perf/main-thread-blocking.perf.test.ts
 *
 * Fixture size: VARLENS_BLOCKING_CASES (default 12) x
 * VARLENS_BLOCKING_VARIANTS_PER_CASE (default 60000).
 * Results: .planning/code-review/ui-ux-audit-2026-10-06/followups/5a-non-blocking-desktop/
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { monitorEventLoopDelay, performance } from 'node:perf_hooks'
import { Worker } from 'node:worker_threads'
import { createRequire } from 'node:module'
import AdmZip from 'adm-zip'
import { DatabaseService } from '../../src/main/database/DatabaseService'
import { VariantFrequencyService } from '../../src/main/database/VariantFrequencyService'
import { ZipExtractor } from '../../src/main/import/ZipExtractor'
import {
  extractZipOffThread,
  setZipWorkerPathForTesting
} from '../../src/main/import/zip-worker-client'
import { runDeleteWorker, startSqliteCaseDeleteJob } from '../../src/main/ipc/handlers/cases-logic'
import { SqliteWriteExecutor } from '../../src/main/storage/sqlite/SqliteWriteExecutor'
import { runCohortExport } from '../../src/main/workers/cohort-export'
import { ExportWorkerClient } from '../../src/main/workers/export-worker-client'
import { rebuildCohortSummary } from '../../src/main/workers/worker-db'
import { bundleWorker } from '../utils/bundle-worker'

const requireFromHere = createRequire(import.meta.url)
const SHOULD_RUN = process.env.VARLENS_RUN_MAIN_BLOCKING_PERF === '1'
const CASES = Number(process.env.VARLENS_BLOCKING_CASES ?? '12')
const PER_CASE = Number(process.env.VARLENS_BLOCKING_VARIANTS_PER_CASE ?? '60000')
const OUT_DIR = resolve(
  process.cwd(),
  '.planning/code-review/ui-ux-audit-2026-10-06/followups/5a-non-blocking-desktop'
)

interface Measurement {
  operation: string
  path: 'before (inline on main)' | 'after (worker)'
  wallMs: number
  maxBlockMs: number
  loopDelayP99Ms: number
  stallsOver50Ms: number
}

async function measure(
  operation: string,
  path: Measurement['path'],
  fn: () => unknown
): Promise<Measurement> {
  const histogram = monitorEventLoopDelay({ resolution: 5 })
  histogram.enable()
  let last = performance.now()
  let maxGap = 0
  let stalls = 0
  const heartbeat = setInterval(() => {
    const now = performance.now()
    const gap = now - last
    if (gap > maxGap) maxGap = gap
    if (gap > 50) stalls += 1
    last = now
  }, 5)
  await new Promise((r) => setTimeout(r, 20))
  const started = performance.now()
  await fn()
  const wallMs = performance.now() - started
  await new Promise((r) => setTimeout(r, 30))
  clearInterval(heartbeat)
  histogram.disable()
  const round = (n: number): number => Math.round(n * 10) / 10
  return {
    operation,
    path,
    wallMs: round(wallMs),
    maxBlockMs: round(Math.max(maxGap, histogram.max / 1e6)),
    loopDelayP99Ms: round(histogram.percentile(99) / 1e6),
    stallsOver50Ms: stalls
  }
}

function seedCases(db: DatabaseService, firstCase: number, count: number): number[] {
  const insertCase = db.database.prepare(
    'INSERT INTO cases (name, file_path, file_size, variant_count, created_at) VALUES (?, ?, 1, ?, 0)'
  )
  const insertVariant = db.database.prepare(
    `INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, consequence, func, gt_num)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const ids: number[] = []
  db.database.transaction(() => {
    for (let c = firstCase; c < firstCase + count; c++) {
      const caseId = Number(
        insertCase.run(`case-${c}`, `/tmp/case-${c}.json`, PER_CASE).lastInsertRowid
      )
      ids.push(caseId)
      for (let v = 0; v < PER_CASE; v++) {
        // ~70% of positions shared across cases, the rest private.
        const pos = v % 10 < 7 ? v * 10 : 10_000_000 + c * PER_CASE + v
        insertVariant.run(
          caseId,
          String((v % 22) + 1),
          pos,
          'A',
          'G',
          `GENE${v % 2000}`,
          'MODERATE',
          'missense_variant',
          '0/1'
        )
      }
    }
  })()
  return ids
}

/** Hold the SQLite write lock from another thread (an import's write phase). */
function holdWriteLock(dbPath: string, ms: number): Promise<void> {
  const code = `
    const { workerData, parentPort } = require('node:worker_threads')
    const Database = require(${JSON.stringify(requireFromHere.resolve('better-sqlite3-multiple-ciphers'))})
    const db = new Database(workerData.dbPath)
    db.pragma('busy_timeout = 5000')
    db.exec('BEGIN IMMEDIATE')
    parentPort.postMessage('locked')
    setTimeout(() => { db.exec('COMMIT'); db.close(); parentPort.postMessage('released') }, workerData.ms)
  `
  return new Promise((resolveLocked) => {
    const worker = new Worker(code, { eval: true, workerData: { dbPath, ms } })
    worker.on('message', (m) => {
      if (m === 'locked') resolveLocked()
      if (m === 'released') void worker.terminate()
    })
  })
}

describe.skipIf(!SHOULD_RUN)('main-thread blocking: before vs after', () => {
  const results: Measurement[] = []
  let dir: string
  let db: DatabaseService
  let caseIds: number[]
  let workers: Record<'delete' | 'export' | 'write' | 'zip', string>

  beforeAll(async () => {
    workers = {
      delete: await bundleWorker('src/main/workers/delete-worker.ts'),
      export: await bundleWorker('src/main/workers/export-worker.ts'),
      write: await bundleWorker('src/main/workers/write-worker.ts'),
      zip: await bundleWorker('src/main/import/zip-worker.ts')
    }
    dir = mkdtempSync(join(tmpdir(), 'varlens-blocking-perf-'))
    db = new DatabaseService(join(dir, 'perf.db'))
    caseIds = seedCases(db, 1, CASES)
    const frequencies = new VariantFrequencyService(db.database)
    for (const id of caseIds) frequencies.updateFrequencies(id)
    rebuildCohortSummary(db.database)
  }, 600_000)

  afterAll(() => {
    if (!SHOULD_RUN) return
    db?.close()
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(OUT_DIR, { recursive: true })
    const meta = {
      cases: CASES,
      variantsPerCase: PER_CASE,
      totalVariants: CASES * PER_CASE,
      node: process.version,
      date: new Date().toISOString()
    }
    writeFileSync(
      join(OUT_DIR, `main-thread-blocking-${CASES}x${PER_CASE}.json`),
      JSON.stringify({ meta, results }, null, 2) + '\n'
    )
    const lines = [
      '# Main-thread blocking — before vs after (PR 8 desktop)',
      '',
      `Fixture: ${CASES} cases x ${PER_CASE.toLocaleString('en-US')} variants (${(CASES * PER_CASE).toLocaleString('en-US')} rows), ${meta.node}, ${meta.date}.`,
      'Generated by `tests/perf/main-thread-blocking.perf.test.ts`. "max block" = longest event-loop stall of the calling (main) thread.',
      '',
      '| Operation | Path | Wall ms | Max block ms | Loop delay p99 ms | Stalls >50 ms |',
      '|---|---|---:|---:|---:|---:|',
      ...results.map(
        (r) =>
          `| ${r.operation} | ${r.path} | ${r.wallMs} | ${r.maxBlockMs} | ${r.loopDelayP99Ms} | ${r.stallsOver50Ms} |`
      )
    ]
    writeFileSync(
      join(OUT_DIR, `main-thread-blocking-${CASES}x${PER_CASE}.md`),
      lines.join('\n') + '\n'
    )
  })

  it('frequency upkeep after import (one case)', async () => {
    const frequencies = new VariantFrequencyService(db.database)
    const id = caseIds[0]
    frequencies.decrementFrequencies(id)
    // After this PR the statement runs inside the import worker's own
    // transaction; the main thread executes nothing for it (no after row).
    results.push(
      await measure('frequency upkeep: updateFrequencies(case)', 'before (inline on main)', () =>
        frequencies.updateFrequencies(id)
      )
    )
  }, 600_000)

  it('frequency upkeep after batch delete (recompute all)', async () => {
    const frequencies = new VariantFrequencyService(db.database)
    results.push(
      await measure('frequency upkeep: recomputeAllFrequencies()', 'before (inline on main)', () =>
        frequencies.recomputeAllFrequencies()
      )
    )
  }, 600_000)

  it('cohort export (XLSX)', async () => {
    const params = { genome_build: 'GRCh38' } as never
    results.push(
      await measure('cohort export (<=100k rows, XLSX)', 'before (inline on main)', () =>
        runCohortExport(db.database, params, join(dir, 'before.xlsx'), () => undefined)
      )
    )
    results.push(
      await measure(
        'cohort export (<=100k rows, XLSX)',
        'after (worker)',
        () =>
          new Promise<void>((done, fail) =>
            new ExportWorkerClient(workers.export).startCohort({
              dbPath: db.getPath(),
              params,
              outputFilePath: join(dir, 'after.xlsx'),
              onProgress: () => undefined,
              onComplete: () => done(),
              onError: (e) => fail(new Error(e))
            })
          )
      )
    )
  }, 600_000)

  it('case delete (one case)', async () => {
    const before = seedCases(db, 1000, 1)[0]
    new VariantFrequencyService(db.database).updateFrequencies(before)
    results.push(
      await measure('case delete (1 case)', 'before (inline on main)', async () => {
        // Pre-PR: decrement on main, then the delete worker.
        db.variants.decrementFrequencies(before)
        await runDeleteWorker(
          { type: 'start', mode: 'ids', dbPath: db.getPath(), ids: [before] },
          { workerPath: workers.delete }
        )
      })
    )
    const after = seedCases(db, 2000, 1)[0]
    new VariantFrequencyService(db.database).updateFrequencies(after)
    results.push(
      await measure(
        'case delete (1 case)',
        'after (worker)',
        () =>
          startSqliteCaseDeleteJob(
            { mode: 'ids', ids: [after] },
            () => db,
            {},
            { workerPath: workers.delete }
          ).result
      )
    )
  }, 600_000)

  it('user write while an import holds the write lock (1.5 s)', async () => {
    const inline = new SqliteWriteExecutor(db, { workerPath: null })
    await holdWriteLock(db.getPath(), 1500)
    results.push(
      await measure('tag write during import write-lock', 'before (inline on main)', () =>
        inline.execute({ type: 'tags:create', params: ['before', '#000000'] })
      )
    )
    const viaWorker = new SqliteWriteExecutor(db, { workerPath: workers.write })
    await viaWorker.execute({ type: 'tags:create', params: ['warmup', '#000000'] })
    await holdWriteLock(db.getPath(), 1500)
    results.push(
      await measure('tag write during import write-lock', 'after (worker)', () =>
        viaWorker.execute({ type: 'tags:create', params: ['after', '#000000'] })
      )
    )
    await viaWorker.close()
  }, 600_000)

  it('ZIP extraction (~40 MB inflated)', async () => {
    const zipPath = join(dir, 'batch.zip')
    const zip = new AdmZip()
    const payload = Buffer.from(
      JSON.stringify({
        variants: Array.from({ length: 200_000 }, (_, i) => ({
          chr: '1',
          pos: i,
          ref: 'A',
          alt: 'G'
        }))
      })
    )
    for (let i = 0; i < 4; i++) zip.addFile(`case-${i}.json`, payload)
    zip.writeZip(zipPath)
    const target = (name: string): string => mkdtempSync(join(dir, name))
    results.push(
      await measure('ZIP extract', 'before (inline on main)', () =>
        new ZipExtractor().extract(zipPath, target('zip-before-'))
      )
    )
    setZipWorkerPathForTesting(workers.zip)
    results.push(
      await measure('ZIP extract', 'after (worker)', () =>
        extractZipOffThread(zipPath, target('zip-after-'))
      )
    )
    setZipWorkerPathForTesting(undefined)
  }, 600_000)

  it('after-path never blocks the main event loop for more than 50 ms', () => {
    const after = results.filter((r) => r.path === 'after (worker)')
    expect(after.length).toBeGreaterThan(0)
    for (const r of after) expect(r.maxBlockMs, r.operation).toBeLessThan(50)
  })
})
