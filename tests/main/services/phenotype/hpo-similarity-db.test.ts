import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildHpoSimilarityDb,
  openHpoGeneScorer,
  readHpoDataStatus
} from '../../../../src/main/services/phenotype/hpo-similarity-db'
import {
  GENES_TO_PHENOTYPE,
  HP_JSON,
  PHENOTYPE_HPOA,
  T
} from '../../../shared/phenotype/hpo-fixture'

let dir: string
let dbPath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hpo-db-'))
  dbPath = join(dir, 'hpo_similarity.db')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const build = (): void =>
  buildHpoSimilarityDb(
    { ontology: HP_JSON, annotations: PHENOTYPE_HPOA, genes: GENES_TO_PHENOTYPE },
    { release: 'v2026-09-01', sha256: { 'hp.json': 'abc' } },
    dbPath
  )

describe('hpo_similarity.db', () => {
  it('reports not installed without a file, and the release once built', () => {
    expect(readHpoDataStatus(dbPath)).toMatchObject({ installed: false, version: null })
    expect(readHpoDataStatus(null).installed).toBe(false)
    build()
    expect(readHpoDataStatus(dbPath)).toMatchObject({
      installed: true,
      version: 'v2026-09-01',
      termCount: 6,
      geneCount: 2
    })
  })

  it('scores genes with the hand-computed Resnik BMA', () => {
    build()
    const scorer = openHpoGeneScorer([T.C, T.E], dbPath)
    expect(scorer).not.toBeNull()
    expect(scorer?.score('GENE1')).toBeCloseTo(Math.log(4 / 3) / 2, 12)
    expect(scorer?.score('GENE2')).toBeCloseTo(Math.log(2), 12)
    expect(scorer?.score('UNKNOWN')).toBeNull()
    scorer?.close()
  })

  it('has no scorer without patient terms or data', () => {
    build()
    expect(openHpoGeneScorer([], dbPath)).toBeNull()
    expect(openHpoGeneScorer([T.C], join(dir, 'missing.db'))).toBeNull()
  })
})
