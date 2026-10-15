/**
 * Phenotype column on a WGS-size case (spec .planning/specs/2026-10-15-phenotype-column.md):
 * the first table query of a case with HPO terms scores it in the scorer worker
 * and stores the rows through the writer thread, so the main thread (the
 * Electron main process in the app) must stay responsive; later queries only
 * join stored values. Real db-worker, write-worker and HPO data.
 *
 *   VARLENS_RUN_PHENO_PERF=1 VARLENS_HPO_DB_PATH=/path/hpo_similarity.db \
 *     npx vitest run --project perf tests/perf/phenotype-column.perf.test.ts
 *
 * VARLENS_PHENO_PERF_VARIANTS (default 2_600_000) sizes the case.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { monitorEventLoopDelay, performance } from 'node:perf_hooks'

import Database from 'better-sqlite3-multiple-ciphers'
import { describe, expect, it } from 'vitest'

import { DatabaseService } from '../../src/main/database/DatabaseService'
import { DbPool } from '../../src/main/database/DbPool'
import { SqliteStorageSession } from '../../src/main/storage/sqlite/SqliteStorageSession'
import type { SortItem, VariantFilter } from '../../src/shared/types/database'
import { bundleWorker } from '../utils/bundle-worker'

const RUN = process.env.VARLENS_RUN_PHENO_PERF === '1'
const HPO = process.env.VARLENS_HPO_DB_PATH
const VARIANTS = Number(process.env.VARLENS_PHENO_PERF_VARIANTS ?? '2600000')
const TERMS = ['HP:0001250', 'HP:0001263', 'HP:0000252'] // seizure, GDD, microcephaly

describe.skipIf(!RUN || HPO === undefined)('phenotype column on a WGS-size case', () => {
  it('scores off the main thread once; sorted reads join stored values', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'varlens-pheno-perf-'))
    const dbPath = join(dir, 'perf.db')
    const genes = (() => {
      const hpo = new Database(HPO!, { readonly: true })
      const list = hpo.prepare('SELECT DISTINCT gene_symbol FROM gene_diseases').pluck().all()
      hpo.close()
      // Real HPO genes plus non-HPO genes, ~20k distinct symbols like a WGS case.
      return [...(list as string[]), ...Array.from({ length: 15000 }, (_, i) => `NOHPO${i}`)]
    })()
    const service = new DatabaseService(dbPath)
    const caseId = service.cases.createCase('wgs', '/wgs.vcf', 1, 'GRCh38')
    const insert = service.database.prepare(
      `INSERT INTO variants (case_id, chr, pos, ref, alt, gene_symbol, gt_num, variant_type)
       VALUES (?, ?, ?, 'A', 'T', ?, '0/1', 'snv')`
    )
    service.database.transaction(() => {
      for (let i = 0; i < VARIANTS; i++) {
        insert.run(
          caseId,
          String((i % 22) + 1),
          1000 + i,
          i % 7 === 0 ? null : genes[i % genes.length]
        )
      }
    })()
    service.database.exec('ANALYZE')
    for (const t of TERMS) service.metadata.assignCaseHpoTerm(caseId, t, t)

    const pool = new DbPool()
    pool.init(dbPath, undefined, {
      workerPath: await bundleWorker('src/main/workers/db-worker.ts')
    })
    const session = new SqliteStorageSession({
      databaseService: service,
      dbPool: pool,
      writeWorkerPath: await bundleWorker('src/main/workers/write-worker.ts')
    })
    const read = session.getReadExecutor()
    const query = async (sortBy?: SortItem[], filter: Partial<VariantFilter> = {}) => {
      const start = performance.now()
      const result = (await read.execute({
        type: 'variants:query',
        params: [{ case_id: caseId, ...filter }, 50, 0, sortBy, false, false]
      })) as { data: Array<{ phenotype_score?: number | null }>; total_count: number }
      return { ms: performance.now() - start, result }
    }
    const desc: SortItem[] = [{ key: 'phenotype_score', order: 'desc' }]
    try {
      await read.execute({ type: 'hpo:prewarm', params: [] }) // index load, as after DB open
      const lag = monitorEventLoopDelay({ resolution: 5 })
      lag.enable()
      const first = await query()
      lag.disable()
      const repeat = await query()
      const sorted = await query(desc)
      const sortedAgain = await query(desc)
      const filtered = await query(undefined, {
        column_filters: { phenotype_score: { operator: '>=', value: 0.5, includeEmpty: false } }
      })
      service.cohortSummary.rebuild()
      const cohort = async (sort: string): Promise<number> => {
        const start = performance.now()
        await read.execute({
          type: 'cohort:query',
          params: [{ limit: 50, offset: 0, sort_by: sort, sort_order: 'desc' }]
        })
        return Math.round(performance.now() - start)
      }
      const report = {
        cohortDefaultMs: await cohort('carrier_count'),
        cohortByPhenotypeMs: await cohort('phenotype_score'),
        variants: VARIANTS,
        firstOpenMs: Math.round(first.ms),
        mainThreadMaxLagMs: Math.round(lag.max / 1e6),
        repeatMs: Math.round(repeat.ms),
        sortedByPhenotypeMs: Math.round(sorted.ms),
        sortedAgainMs: Math.round(sortedAgain.ms),
        filteredGe05Ms: Math.round(filtered.ms),
        filteredCount: filtered.result.total_count,
        topScore: sorted.result.data[0]?.phenotype_score
      }
      process.stdout.write(`PHENO_PERF ${JSON.stringify(report)}\n`)
      expect(sorted.result.data[0]?.phenotype_score).toBeGreaterThan(0)
    } finally {
      await session.close()
      rmSync(dir, { recursive: true, force: true })
    }
  }, 1_800_000)
})
