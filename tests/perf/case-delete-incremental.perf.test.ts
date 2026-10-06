/**
 * Single-case delete wall time — full rebuild (before) vs incremental FTS +
 * cohort summary (after). Audit 05 finding D-1.
 *
 * Gated by VARLENS_RUN_DELETE_PERF=1:
 *
 *   VARLENS_RUN_DELETE_PERF=1 VARLENS_BLOCKING_CASES=20 \
 *   VARLENS_BLOCKING_VARIANTS_PER_CASE=250000 \
 *     npx vitest run --project perf tests/perf/case-delete-incremental.perf.test.ts
 *
 * "before" replays the pre-change delete worker inline (drop FTS triggers,
 * per-case delete + frequency decrement, global FTS 'rebuild' + ANALYZE,
 * full cohort-summary rebuild). "after" runs the real delete job through the
 * bundled delete worker. Both delete a same-sized case from the same database.
 * Results: .planning/code-review/ui-ux-audit-2026-10-06/followups/leftovers-l2/
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { DatabaseService } from '../../src/main/database/DatabaseService'
import { VariantFrequencyService } from '../../src/main/database/VariantFrequencyService'
import { startSqliteCaseDeleteJob } from '../../src/main/ipc/handlers/cases-logic'
import { deleteCasesIncrementally } from '../../src/main/workers/delete-operations'
import { MARK_STALE_SQL } from '../../src/shared/sql/cohort-summary-rebuild'
import {
  DROP_FTS_TRIGGERS,
  rebuildCohortSummary,
  rebuildFts
} from '../../src/main/workers/worker-db'
import { bundleWorker } from '../utils/bundle-worker'

const SHOULD_RUN = process.env.VARLENS_RUN_DELETE_PERF === '1'
const CASES = Number(process.env.VARLENS_BLOCKING_CASES ?? '12')
const PER_CASE = Number(process.env.VARLENS_BLOCKING_VARIANTS_PER_CASE ?? '60000')
const OUT_DIR = resolve(
  process.cwd(),
  '.planning/code-review/ui-ux-audit-2026-10-06/followups/leftovers-l2'
)

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
          v % 3 === 0 ? '1/1' : '0/1'
        )
      }
    }
  })()
  return ids
}

/** The pre-change delete worker body, run inline for its wall time. */
async function deleteWithFullRebuild(db: DatabaseService, caseId: number): Promise<void> {
  const conn = db.database
  conn.exec(DROP_FTS_TRIGGERS)
  conn.exec(MARK_STALE_SQL)
  await deleteCasesIncrementally(conn, [caseId], {
    deletingAll: false,
    isCancelled: () => false,
    onProgress: () => undefined
  })
  rebuildFts(conn)
  rebuildCohortSummary(conn)
}

interface Row {
  path: string
  wallMs: number
  phases: string
}

describe.skipIf(!SHOULD_RUN)('case delete: full rebuild vs incremental', () => {
  const rows: Row[] = []
  let dir: string
  let db: DatabaseService
  let workerPath: string

  beforeAll(async () => {
    workerPath = await bundleWorker('src/main/workers/delete-worker.ts')
    dir = mkdtempSync(join(tmpdir(), 'varlens-delete-perf-'))
    db = new DatabaseService(join(dir, 'perf.db'))
    const ids = seedCases(db, 1, CASES)
    const frequencies = new VariantFrequencyService(db.database)
    for (const id of ids) frequencies.updateFrequencies(id)
    db.cohortSummary.rebuild()
  }, 3_600_000)

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
    const base = `case-delete-${CASES}x${PER_CASE}`
    writeFileSync(join(OUT_DIR, `${base}.json`), JSON.stringify({ meta, rows }, null, 2) + '\n')
    writeFileSync(
      join(OUT_DIR, `${base}.md`),
      [
        '# Single-case delete — full rebuild vs incremental (audit D-1)',
        '',
        `Fixture: ${CASES} cases x ${PER_CASE.toLocaleString('en-US')} variants (${meta.totalVariants.toLocaleString('en-US')} rows) + 1 extra case per path, ${meta.node}, ${meta.date}.`,
        'Generated by `tests/perf/case-delete-incremental.perf.test.ts`.',
        '',
        '| Path | Wall ms | Phases |',
        '|---|---:|---|',
        ...rows.map((r) => `| ${r.path} | ${r.wallMs} | ${r.phases} |`)
      ].join('\n') + '\n'
    )
  })

  it('deletes one case', async () => {
    const [beforeId] = seedCases(db, 10_000, 1)
    new VariantFrequencyService(db.database).updateFrequencies(beforeId)
    db.cohortSummary.rebuild()
    let started = performance.now()
    await deleteWithFullRebuild(db, beforeId)
    rows.push({
      path: 'before: FTS rebuild + full summary rebuild',
      wallMs: Math.round(performance.now() - started),
      phases: 'deleting, rebuilding-search-index, rebuilding-cohort-summary'
    })

    const [afterId] = seedCases(db, 20_000, 1)
    new VariantFrequencyService(db.database).updateFrequencies(afterId)
    db.cohortSummary.rebuild()
    const phases = new Set<string>()
    started = performance.now()
    const handle = startSqliteCaseDeleteJob(
      { mode: 'ids', ids: [afterId] },
      () => db,
      {},
      { workerPath }
    )
    const { jobRunner } = await import('../../src/main/services/jobs/runner')
    const off = jobRunner.onLifecycle((job) => {
      if (job.id === handle.id && job.progress?.message) phases.add(job.progress.message)
    })
    await handle.result
    off()
    rows.push({
      path: 'after: row-trigger FTS + incremental summary (worker job)',
      wallMs: Math.round(performance.now() - started),
      phases: [...phases].join(', ')
    })
    expect(phases.has('rebuilding-cohort-summary')).toBe(false)
    expect(db.cohortSummary.getStatus().is_stale).toBe(false)
  }, 3_600_000)
})
