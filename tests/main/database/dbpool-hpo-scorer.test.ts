/**
 * One HPO index per read pool (#631): shortlists and HPO prewarms run on one
 * dedicated db-worker, so exactly one ~145 MB index copy exists, and an HPO
 * install is picked up by the next ranking. Runs the real bundled db-worker.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseService } from '../../../src/main/database/DatabaseService'
import { DbPool } from '../../../src/main/database/DbPool'
import {
  buildHpoSimilarityDb,
  prewarmHpoIndexInPool
} from '../../../src/main/services/phenotype/hpo-similarity-db'
import { HPO_DATA_CONFIG } from '../../../src/shared/config/hpo-data.config'
import type { ShortlistConfig, ShortlistResult } from '../../../src/shared/types/shortlist'
import { EVIDENCE_CONFIG, EVIDENCE_RULESET } from '../../fixtures/shortlist/evidence-fixture'
import { GENES_TO_PHENOTYPE, HP_JSON, PHENOTYPE_HPOA, T } from '../../shared/phenotype/hpo-fixture'
import { bundleWorker } from '../../utils/bundle-worker'

const HPO_CONFIG: ShortlistConfig = {
  ...EVIDENCE_CONFIG,
  rankConfig: {
    ...EVIDENCE_CONFIG.rankConfig,
    ruleset: {
      ...EVIDENCE_RULESET,
      groups: [
        ...EVIDENCE_RULESET.groups,
        {
          id: 'hpo',
          label: 'HPO',
          scope: 'global',
          rules: [{ id: 'hpo', label: 'HPO', when: 'hpo_resnik:>:0', points: 1 }]
        }
      ]
    }
  }
}

describe('DbPool HPO scorer worker', () => {
  let dir: string
  let hpoPath: string
  let pool: DbPool
  let caseId: number
  const previousEnv = process.env[HPO_DATA_CONFIG.envPath]

  beforeAll(async () => {
    const workerPath = await bundleWorker('src/main/workers/db-worker.ts')
    dir = mkdtempSync(join(tmpdir(), 'varlens-dbpool-hpo-'))
    hpoPath = join(dir, 'hpo_similarity.db')
    // Workers copy the environment when they spawn; no HPO data is installed yet.
    process.env[HPO_DATA_CONFIG.envPath] = hpoPath
    const path = join(dir, 'a.db')
    const db = new DatabaseService(path)
    caseId = db.cases.createCase('hpo', '/path/hpo.vcf', 1, 'GRCh38')
    db.database
      .prepare(
        `INSERT INTO variants (case_id, variant_type, chr, pos, ref, alt, gene_symbol, gt_num,
                               consequence, func)
         VALUES (?, 'snv', '1', 100, 'A', 'G', 'GENE2', '0/1', 'HIGH', 'stop_gained')`
      )
      .run(caseId)
    db.metadata.assignCaseHpoTerm(caseId, T.C, 'C')
    db.close()
    pool = new DbPool()
    pool.init(path, undefined, { workerPath, maxThreads: 4 })
  }, 60_000)

  afterAll(async () => {
    await pool.destroy()
    if (previousEnv === undefined) delete process.env[HPO_DATA_CONFIG.envPath]
    else process.env[HPO_DATA_CONFIG.envPath] = previousEnv
    rmSync(dir, { recursive: true, force: true })
  })

  const rank = (): Promise<ShortlistResult> =>
    pool.run<ShortlistResult>({
      type: 'variants:shortlist',
      params: [{ caseId, adHocConfig: HPO_CONFIG }]
    })
  const hpoPoints = (r: ShortlistResult): number | undefined =>
    r.rows[0].rank_evidence?.find((c) => c.id === 'hpo')?.points

  it('runs every scorer task on one worker while other reads use the pool', async () => {
    const reads = Array.from({ length: 8 }, () => pool.run({ type: 'cases:list', params: [] }))
    const scorerThreads = await Promise.all(
      Array.from({ length: 8 }, () => pool.run<number>({ type: 'hpo:prewarm', params: [] }))
    )
    await Promise.all(reads)
    expect(new Set(scorerThreads).size).toBe(1)
  })

  it('uses newly installed HPO data on the next ranking', async () => {
    expect(hpoPoints(await rank())).toBeUndefined()
    buildHpoSimilarityDb(
      { ontology: HP_JSON, annotations: PHENOTYPE_HPOA, genes: GENES_TO_PHENOTYPE },
      { release: 'v2026-09-01', sha256: {} },
      hpoPath
    )
    prewarmHpoIndexInPool(pool)
    expect(hpoPoints(await rank())).toBe(1)
  })
})
