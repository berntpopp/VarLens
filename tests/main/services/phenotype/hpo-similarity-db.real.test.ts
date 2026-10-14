/**
 * Disease-level behaviour on the real HPO v2026-09-01 release (private data
 * cache of the simulation harness; skipped when absent). Pins the case that
 * motivated scoring v2: excluding microcephaly in a Dravet-like profile must
 * demote the SCN1A disease that lists microcephaly as frequent (ORPHA:293181)
 * without losing SCN1A, which still matches Dravet syndrome.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HPO_SCORING_CONFIG } from '../../../../src/shared/config/hpo-scoring.config'
import {
  buildHpoSimilarityDb,
  loadPhenotypeIndex,
  openHpoGeneScorer
} from '../../../../src/main/services/phenotype/hpo-similarity-db'
import { scoreCase } from '../../../../src/shared/phenotype/phenotype-score'
import type { HpoProfileTerm } from '../../../../src/shared/types/hpo-profile'

const DATA_DIR =
  process.env.VARLENS_SIM_DATA_DIR ?? resolve(__dirname, '../../../../../_data/shortlist-sim')
const RAW = join(DATA_DIR, 'cache', 'hpo', 'raw-v2026-09-01')
const HAS_DATA = existsSync(join(RAW, 'phenotype.hpoa'))

const P = (hpoId: string): HpoProfileTerm => ({ hpoId, excluded: false, key: false })
const X = (hpoId: string): HpoProfileTerm => ({ hpoId, excluded: true, key: false })
const MICROCEPHALY = 'HP:0000252'
// Febrile seizure, bilateral tonic-clonic seizure, developmental regression, hypotonia,
// multifocal epileptiform discharges.
const DRAVET_LIKE = ['HP:0002373', 'HP:0002069', 'HP:0002376', 'HP:0001252', 'HP:0010841'].map(P)

let dir: string
let dbPath: string

describe.skipIf(!HAS_DATA)('phenotype score v2 on the real HPO release', () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'hpo-real-'))
    dbPath = join(dir, 'hpo_similarity.db')
    const read = (f: string): string => readFileSync(join(RAW, f), 'utf8')
    buildHpoSimilarityDb(
      {
        ontology: read('hp.json'),
        annotations: read('phenotype.hpoa'),
        genes: read('genes_to_phenotype.txt')
      },
      { release: 'v2026-09-01', sha256: {} },
      dbPath
    )
  }, 60_000)
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('excluding microcephaly demotes ORPHA:293181 but keeps SCN1A via Dravet syndrome', () => {
    const before = openHpoGeneScorer(DRAVET_LIKE, dbPath)!
    const after = openHpoGeneScorer([...DRAVET_LIKE, X(MICROCEPHALY)], dbPath)!
    expect(before.bestDisease('SCN1A')).toBe('ORPHA:293181')
    expect(before.explain('SCN1A')!.conflicts).toEqual([])

    expect(after.bestDisease('SCN1A')).not.toBe('ORPHA:293181')
    expect(after.score('SCN1A')!).toBeGreaterThanOrEqual(before.score('SCN1A')! - 0.05)
    expect(after.explain('SCN1A')!.conflicts).toEqual([])
    // ORPHA:293181 itself: microcephaly is "frequent" there (f_excl 0.3) → penalised.
    const ix = loadPhenotypeIndex(dbPath)!
    const d = ix.diseaseIds.indexOf('ORPHA:293181')
    const plain = scoreCase(ix, DRAVET_LIKE)!.diseaseScore[d]
    const excluded = scoreCase(ix, [...DRAVET_LIKE, X(MICROCEPHALY)])!.diseaseScore[d]
    expect(excluded).toBeLessThanOrEqual(plain * Math.exp(-HPO_SCORING_CONFIG.lambda * 0.29))
  })
})
