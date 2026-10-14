import Database from 'better-sqlite3-multiple-ciphers'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
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
      needsUpdate: false,
      termCount: 10,
      geneCount: 3
    })
  })

  it('stores only positively supported phenotype-subtree gene terms', () => {
    build()
    const db = new Database(dbPath, { readonly: true })
    const rows = db.prepare('SELECT gene_symbol, term FROM gene_terms ORDER BY 1, 2').all()
    db.close()
    expect(rows).toEqual([
      { gene_symbol: 'GENE1', term: T.D },
      { gene_symbol: 'GENE2', term: T.C },
      { gene_symbol: 'GENE2', term: T.E },
      { gene_symbol: 'GENE3', term: T.D }
    ])
  })

  it('scores genes with the hand-computed symmetric Resnik BMA', () => {
    build()
    const scorer = openHpoGeneScorer([T.C, T.E], dbPath)
    expect(scorer).not.toBeNull()
    const l43 = Math.log(4 / 3)
    expect(scorer?.score('GENE1')).toBeCloseTo((l43 / 2 + l43) / 2, 12)
    expect(scorer?.score('GENE2')).toBeCloseTo(Math.log(2), 12)
    expect(scorer?.score('UNKNOWN')).toBeNull()
    scorer?.close()
  })

  it('canonicalises, deduplicates and drops non-phenotype case terms before scoring', () => {
    build()
    const plain = openHpoGeneScorer([T.C, T.E], dbPath)
    const noisy = openHpoGeneScorer([T.ALT, T.C, T.Z2, T.INH, 'HP:9999999'], dbPath)
    expect(noisy?.score('GENE1')).toBeCloseTo(plain!.score('GENE1')!, 12)
    expect(noisy?.score('GENE2')).toBeCloseTo(plain!.score('GENE2')!, 12)
    expect(openHpoGeneScorer([T.INH], dbPath)).toBeNull()
  })

  it('reloads the cached index when the file is replaced', () => {
    build()
    expect(openHpoGeneScorer([T.C], dbPath)?.score('GENE2')).not.toBeNull()
    writeFileSync(dbPath, 'replaced by something unreadable '.repeat(300))
    expect(openHpoGeneScorer([T.C], dbPath)).toBeNull()
  })

  it('has no scorer without patient terms or data', () => {
    build()
    expect(openHpoGeneScorer([], dbPath)).toBeNull()
    expect(openHpoGeneScorer([T.C], join(dir, 'missing.db'))).toBeNull()
  })

  it('treats a damaged file as "needs update" and scores nothing, without throwing', () => {
    writeFileSync(dbPath, 'not a database at all, just bytes '.repeat(200))
    expect(readHpoDataStatus(dbPath)).toMatchObject({ installed: false, needsUpdate: true })
    expect(openHpoGeneScorer([T.C], dbPath)).toBeNull()
  })

  it('reports a DB from an older builder as needing an update', () => {
    build()
    const db = new Database(dbPath)
    db.prepare("UPDATE meta SET value = '1' WHERE key = 'builder_version'").run()
    db.close()
    expect(readHpoDataStatus(dbPath)).toMatchObject({ installed: true, needsUpdate: true })
  })
})
