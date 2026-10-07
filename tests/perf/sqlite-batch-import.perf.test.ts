/**
 * SQLite batch-import benchmark (desktop batch path, no Electron).
 *
 * Imports N files as ONE batch through the real import worker session
 * (`runImportSession`, the function the worker thread runs) into a fresh
 * database file created by `DatabaseService` (real schema + migrations), with
 * the file list prepared exactly as `startBatchImport` prepares it. Records
 * per-sample wall time, a per-phase breakdown, sizes, row counts and a result
 * fingerprint so later optimisations can prove results are unchanged.
 *
 * Gated by VARLENS_RUN_SQLITE_BATCH_PERF=1:
 *
 *   npx tsx scripts/simulate-variants.ts --samples 20 --variants 60000 \
 *     --formats vcf --out tests/.cache/sim20
 *   VARLENS_RUN_SQLITE_BATCH_PERF=1 VARLENS_SQLITE_BATCH_LABEL=baseline \
 *     npx vitest run --project perf tests/perf/sqlite-batch-import.perf.test.ts
 *
 * Env:
 *   VARLENS_SQLITE_BATCH_DIR      input dir (default tests/.cache/sim20)
 *   VARLENS_SQLITE_BATCH_SAMPLES  files to import, in name order (default 20)
 *   VARLENS_SQLITE_BATCH_LABEL    artifact label (default "local")
 *   VARLENS_SQLITE_BATCH_PROFILE  "0" disables SQL phase wrapping (wall only)
 *   VARLENS_SQLITE_BATCH_DB_DIR   where the temp DB lives (default
 *                                 tests/.cache/sqlite-batch-db — a real disk;
 *                                 /tmp is tmpfs on some hosts)
 *   VARLENS_SQLITE_BATCH_KEEP_DB  "1" keeps the database for inspection
 *
 * Artifacts: .planning/artifacts/perf/sqlite-batch-import/<label>-<ts>.{json,md}
 * (gitignored).
 *
 * Differences from the desktop: the session runs on this thread rather than
 * in a worker thread (no structured-clone messaging, no worker heap limit),
 * and the "main" connection is a `DatabaseService` in the same process.
 * Phase attribution is done from outside by tests/perf/support/sql-phase-profiler.ts;
 * production code carries no instrumentation.
 */
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'

import { DatabaseService } from '../../src/main/database/DatabaseService'
import { checkDuplicates } from '../../src/main/import/batch-utils'
import { runImportSession, type ImportWorkerPort } from '../../src/main/workers/import-worker'
import { API_CONFIG, DATABASE_CONFIG } from '../../src/shared/config'
import type { FileImportRequest, WorkerMessage } from '../../src/shared/types/import-worker'
import {
  REBUILD_GENE_BURDEN_SQL,
  REBUILD_VARIANT_SUMMARY_SQL
} from '../../src/shared/sql/cohort-summary-rebuild'
import {
  diffSnapshots,
  SqlPhaseProfiler,
  sumMs,
  type PhaseSnapshot
} from './support/sql-phase-profiler'
import {
  dbSizes,
  fingerprintDatabase,
  renderMarkdown,
  runStatementDiagnostics,
  type BatchReport,
  type SampleResult
} from './support/sqlite-batch-report'

const SHOULD_RUN = process.env.VARLENS_RUN_SQLITE_BATCH_PERF === '1'
const INPUT_DIR = resolve(
  process.cwd(),
  process.env.VARLENS_SQLITE_BATCH_DIR ?? 'tests/.cache/sim20'
)
const SAMPLES = Number(process.env.VARLENS_SQLITE_BATCH_SAMPLES ?? '20')
const LABEL = process.env.VARLENS_SQLITE_BATCH_LABEL ?? 'local'
const PROFILE = process.env.VARLENS_SQLITE_BATCH_PROFILE !== '0'
const KEEP_DB = process.env.VARLENS_SQLITE_BATCH_KEEP_DB === '1'
const DB_DIR = resolve(
  process.cwd(),
  process.env.VARLENS_SQLITE_BATCH_DB_DIR ?? 'tests/.cache/sqlite-batch-db'
)
const ARTIFACT_DIR = resolve(process.cwd(), '.planning/artifacts/perf/sqlite-batch-import')
const IMPORTABLE = /\.(vcf|vcf\.gz|json|json\.gz)$/i

function listInputFiles(): string[] {
  const files = readdirSync(INPUT_DIR)
    .filter((name) => IMPORTABLE.test(name) && name !== 'manifest.json')
    .sort()
    .slice(0, SAMPLES)
    .map((name) => join(INPUT_DIR, name))
  if (files.length < SAMPLES) {
    throw new Error(`Need ${SAMPLES} importable files in ${INPUT_DIR}, found ${files.length}`)
  }
  return files
}

function gitHead(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

interface SessionOutcome {
  samples: SampleResult[]
  sessionStart: PhaseSnapshot
  batchEnd: PhaseSnapshot
  totalPhases: PhaseSnapshot
  totals: Record<string, number>
  errors: string[]
  succeeded: number
}

/** Summary state a reader on the main connection sees right after a file. */
function probeSummary(service: DatabaseService): { rows: number; isStale: string | null } {
  const rows = service.database
    .prepare('SELECT COUNT(*) AS c FROM cohort_variant_summary')
    .get() as { c: number }
  const stale = service.database
    .prepare("SELECT value FROM cohort_summary_meta WHERE key = 'is_stale'")
    .get() as { value: string } | undefined
  return { rows: rows.c, isStale: stale?.value ?? null }
}

async function runBatch(
  service: DatabaseService,
  files: FileImportRequest[],
  profiler: SqlPhaseProfiler
): Promise<SessionOutcome> {
  const dbPath = service.getPath()
  const samples: SampleResult[] = []
  const errors: string[] = []
  let sessionStart: PhaseSnapshot = {}
  let fileStartMs = 0
  let fileStartSnapshot: PhaseSnapshot = {}
  let afterLastFileSnapshot: PhaseSnapshot = {}
  let afterLastFileMs = 0
  let probeMs = 0
  let succeeded = 0

  const port: ImportWorkerPort = {
    postMessage: (message: WorkerMessage) => {
      if (message.type === 'case-started') {
        fileStartMs = performance.now()
        fileStartSnapshot = profiler.snapshot()
        if (samples.length === 0) sessionStart = diffSnapshots({}, fileStartSnapshot)
      } else if (message.type === 'file-complete') {
        const wallMs = performance.now() - fileStartMs
        const phases = diffSnapshots(fileStartSnapshot, profiler.snapshot())
        const sqlMs = sumMs(phases)
        const probeStart = performance.now()
        const probe = probeSummary(service)
        samples.push({
          index: message.fileIndex,
          fileName: files[message.fileIndex].filePath.split('/').pop() ?? '',
          variantCount: message.result.variantCount,
          wallMs,
          sqlMs,
          parseMapMs: wallMs - sqlMs,
          phases,
          ...dbSizes(dbPath),
          rssBytes: process.memoryUsage().rss,
          summaryRowsAfterFile: probe.rows,
          isStaleAfterFile: probe.isStale
        })
        afterLastFileSnapshot = profiler.snapshot()
        afterLastFileMs = performance.now()
        probeMs += afterLastFileMs - probeStart
      } else if (message.type === 'error') {
        errors.push(`file ${message.fileIndex}: ${message.error}`)
      } else if (message.type === 'complete') {
        succeeded = message.results.succeeded
      }
    }
  }

  const t0 = performance.now()
  await runImportSession(
    {
      type: 'start',
      files,
      dbPath,
      encryptionKey: service.getEncryptionKey(),
      throttleMs: API_CONFIG.PROGRESS_THROTTLE_MS
    },
    port
  )
  const end = performance.now()
  const totalPhases = profiler.snapshot()
  const perFileMs = samples.reduce((total, sample) => total + sample.wallMs, 0)

  return {
    samples,
    sessionStart,
    batchEnd: diffSnapshots(afterLastFileSnapshot, totalPhases),
    totalPhases,
    totals: {
      'session wall (excl. harness probes)': end - t0 - probeMs,
      'sum of per-sample wall': perFileMs,
      'session start (open, drop triggers/indexes, mark stale)': sumMs(sessionStart),
      'batch end (FTS, ANALYZE, summary rebuild, indexes, checkpoint)': end - afterLastFileMs,
      'harness probes (excluded)': probeMs
    },
    errors,
    succeeded
  }
}

describe.skipIf(!SHOULD_RUN)('sqlite batch import perf', () => {
  it(
    `imports ${SAMPLES} files from ${INPUT_DIR} as one batch`,
    async () => {
      const filePaths = listInputFiles()
      mkdirSync(DB_DIR, { recursive: true })
      const runDir = mkdtempSync(join(DB_DIR, 'run-'))
      const dbPath = join(runDir, 'batch.db')
      const profiler = new SqlPhaseProfiler(
        [
          [REBUILD_VARIANT_SUMMARY_SQL, 'cohort_summary_rebuild'],
          [REBUILD_GENE_BURDEN_SQL, 'gene_burden_rebuild']
        ],
        PROFILE
      )
      const service = new DatabaseService(dbPath)
      let serviceOpen = true

      try {
        // Let DatabaseService's deferred post-constructor housekeeping finish.
        await new Promise((done) => setTimeout(done, 500))

        // Same preparation as startBatchImport (batch-import-logic.ts).
        const files: FileImportRequest[] = checkDuplicates(service, filePaths).files.map((f) => ({
          filePath: f.filePath,
          caseName: f.caseName,
          isDuplicate: f.isDuplicate,
          duplicateStrategy: 'skip'
        }))

        profiler.install()
        let outcome: SessionOutcome
        try {
          outcome = await runBatch(service, files, profiler)
        } finally {
          profiler.uninstall()
        }
        service.close()
        serviceOpen = false

        const finalSizes = dbSizes(dbPath)
        const fingerprint = fingerprintDatabase(dbPath)
        const copyPath = join(runDir, 'diagnostic-copy.db')
        copyFileSync(dbPath, copyPath)
        const diagnostics = runStatementDiagnostics(copyPath)

        const timestamp = new Date().toISOString()
        const report: BatchReport = {
          label: LABEL,
          timestamp,
          environment: {
            git: gitHead(),
            node: process.version,
            cpu: cpus()[0]?.model ?? 'unknown',
            inputDir: INPUT_DIR,
            samples: SAMPLES,
            dbDir: DB_DIR,
            sqlProfiling: PROFILE,
            batchInsertSize: DATABASE_CONFIG.BATCH_INSERT_SIZE
          },
          samples: outcome.samples,
          sessionStart: outcome.sessionStart,
          batchEnd: outcome.batchEnd,
          totals: outcome.totals,
          totalPhases: outcome.totalPhases,
          finalSizes,
          fingerprint,
          diagnostics
        }

        mkdirSync(ARTIFACT_DIR, { recursive: true })
        const base = resolve(ARTIFACT_DIR, `${LABEL}-${timestamp.replace(/[:.]/g, '-')}`)
        const markdown = renderMarkdown(report)
        writeFileSync(`${base}.json`, JSON.stringify(report, null, 2))
        writeFileSync(`${base}.md`, markdown)
        console.log(markdown)
        console.log(`[sqlite-batch-perf] artifacts: ${base}.{json,md}`)

        expect(outcome.errors).toEqual([])
        expect(outcome.succeeded).toBe(SAMPLES)
        expect(fingerprint.counts.cases).toBe(SAMPLES)
        expect(fingerprint.isStale).toBe('0')
      } finally {
        if (serviceOpen) service.close()
        if (!KEEP_DB) rmSync(runDir, { recursive: true, force: true })
      }
    },
    30 * 60_000
  )
})
