import Database from 'better-sqlite3-multiple-ciphers'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildHpoSimilarityDb,
  openHpoGeneScorer,
  prewarmHpoIndex,
  readHpoDataStatus
} from '../../../../src/main/services/phenotype/hpo-similarity-db'
import {
  GENES_TO_PHENOTYPE,
  HP_JSON,
  PHENOTYPE_HPOA,
  T
} from '../../../shared/phenotype/hpo-fixture'
import type { HpoProfileTerm } from '../../../../src/shared/types/hpo-profile'
import { HPO_SCORING_CONFIG } from '../../../../src/shared/config/hpo-scoring.config'
import { nullParams } from '../../../../src/shared/phenotype/phenotype-calibration'

const P = (hpoId: string): HpoProfileTerm => ({ hpoId, excluded: false, key: false })

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

  it('stores gene-linked diseases with frequencies, NOT annotations and gene links', () => {
    build()
    const db = new Database(dbPath, { readonly: true })
    const all = (sql: string): unknown[] => db.prepare(sql).raw().all()
    expect(all('SELECT * FROM gene_diseases ORDER BY 1, 2')).toEqual([
      ['GENE1', 'OMIM:2'],
      ['GENE2', 'OMIM:3'],
      ['GENE2', 'OMIM:4'],
      ['GENE3', 'OMIM:2']
    ])
    expect(all('SELECT disease, term, f, f_excl FROM disease_terms ORDER BY 1, 2')).toEqual([
      ['OMIM:2', T.D, 0.35, 0.15],
      ['OMIM:3', T.E, 0.35, 0.15],
      ['OMIM:4', T.C, 0.35, 0.15],
      ['OMIM:4', T.E, 0.35, 0.15]
    ])
    expect(all('SELECT * FROM disease_not ORDER BY 1, 2')).toEqual([
      ['OMIM:2', T.X],
      ['OMIM:3', T.X],
      ['OMIM:4', T.D]
    ])
    expect(all('SELECT * FROM diseases ORDER BY 1')).toEqual([
      ['OMIM:2', 'name'],
      ['OMIM:3', 'name'],
      ['OMIM:4', 'name']
    ])
    db.close()
  })

  it('scores genes at disease level with the hand-computed v2 score', () => {
    build()
    const scorer = openHpoGeneScorer([P(T.C), P(T.E)], dbPath)
    expect(scorer).not.toBeNull()
    // OMIM:4 {C, E}, both missing frequency (f = 0.35): both patient terms match exactly.
    const f = Math.fround(0.35)
    const fac = Math.fround(0.75 + 0.25 * f)
    expect(scorer?.score('GENE2')).toBeCloseTo(0.55 * fac + 0.45 * ((2 * f) / (1 + 2 * f)), 6)
    expect(scorer?.bestDisease('GENE2')).toBe('OMIM:4')
    expect(scorer?.conflicts('GENE2')).toBe(0)
    expect(scorer?.explain('GENE2')).toMatchObject({ diseaseId: 'OMIM:4', diseaseLabel: 'name' })
    expect(scorer?.score('UNKNOWN')).toBeNull()
    expect(scorer?.explain('UNKNOWN')).toBeNull()
  })

  it('canonicalises, deduplicates and drops non-phenotype case terms before scoring', () => {
    build()
    const plain = openHpoGeneScorer([P(T.C), P(T.E)], dbPath)
    const noisy = openHpoGeneScorer([P(T.ALT), P(T.C), P(T.Z2), P(T.INH), P('HP:9999999')], dbPath)
    expect(noisy?.score('GENE1')).toBeCloseTo(plain!.score('GENE1')!, 12)
    expect(noisy?.score('GENE2')).toBeCloseTo(plain!.score('GENE2')!, 12)
    expect(openHpoGeneScorer([P(T.INH)], dbPath)).toBeNull()
    expect(openHpoGeneScorer([{ hpoId: T.C, excluded: true, key: false }], dbPath)).toBeNull()
  })

  it('counts an excluded term contradicted by the best disease', () => {
    build()
    const scorer = openHpoGeneScorer([P(T.D), { hpoId: T.B, excluded: true, key: false }], dbPath)
    // GENE2: OMIM:4 (C, E) vs OMIM:3 (E); B ⊃ E is excluded in both, OMIM:4 matches D best.
    expect(scorer?.conflicts('GENE2')).toBe(1)
    expect(scorer?.explain('GENE2')?.conflicts).toEqual([
      expect.objectContaining({ excludedTerm: T.B, diseaseTerm: T.E, frequency: Math.fround(0.15) })
    ])
  })

  it('reloads the cached index when the file is replaced', () => {
    build()
    expect(openHpoGeneScorer([P(T.C)], dbPath)?.score('GENE2')).not.toBeNull()
    writeFileSync(dbPath, 'replaced by something unreadable '.repeat(300))
    expect(openHpoGeneScorer([P(T.C)], dbPath)).toBeNull()
  })

  it('builds no background null by default (correction off), and refuses a correction then', () => {
    build()
    const db = new Database(dbPath, { readonly: true })
    expect(db.prepare('SELECT COUNT(*) AS c FROM disease_null').get()).toEqual({ c: 0 })
    db.close()
    expect(openHpoGeneScorer([P(T.C)], dbPath, { correction: 'mean' })).toBeNull()
    expect(openHpoGeneScorer([P(T.C)], dbPath)).not.toBeNull()
  })

  it('stores a background null per disease and scores in every correction mode', () => {
    buildHpoSimilarityDb(
      { ontology: HP_JSON, annotations: PHENOTYPE_HPOA, genes: GENES_TO_PHENOTYPE },
      { release: 'v2026-09-01', sha256: {} },
      dbPath,
      0
    )
    const db = new Database(dbPath, { readonly: true })
    const blobs = db.prepare('SELECT mu, sd FROM disease_null').raw().all() as Array<
      [Buffer, Buffer]
    >
    const params = db.prepare("SELECT value FROM meta WHERE key = 'null_params'").get()
    db.close()
    expect(blobs).toHaveLength(3)
    for (const [mu, sd] of blobs) {
      expect(mu.byteLength).toBe(HPO_SCORING_CONFIG.nullMaxK * 4)
      expect(sd.byteLength).toBe(HPO_SCORING_CONFIG.nullMaxK * 4)
    }
    expect(params).toEqual({ value: nullParams(0) })
    for (const correction of ['off', 'mean', 'z'] as const) {
      const score = openHpoGeneScorer([P(T.C), P(T.E)], dbPath, { correction, tau: 0 })?.score(
        'GENE2'
      )
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(1)
    }
    // A null built for another τ is refused (logged; no scorer) rather than silently misused.
    expect(openHpoGeneScorer([P(T.C)], dbPath, { correction: 'z', tau: 1 })).toBeNull()
  })

  it('needs an update unless a configured correction has a complete null for its τ', () => {
    const config = HPO_SCORING_CONFIG as { backgroundCorrection: string }
    const buildNull = (tau: number | null): void =>
      buildHpoSimilarityDb(
        { ontology: HP_JSON, annotations: PHENOTYPE_HPOA, genes: GENES_TO_PHENOTYPE },
        { release: 'v2026-09-01', sha256: {} },
        dbPath,
        tau
      )
    buildNull(null)
    expect(readHpoDataStatus(dbPath).needsUpdate).toBe(false)
    config.backgroundCorrection = 'mean'
    try {
      expect(readHpoDataStatus(dbPath).needsUpdate).toBe(true)
      buildNull(HPO_SCORING_CONFIG.tau === 0 ? 1 : 0)
      expect(readHpoDataStatus(dbPath).needsUpdate).toBe(true)
      buildNull(HPO_SCORING_CONFIG.tau)
      expect(readHpoDataStatus(dbPath).needsUpdate).toBe(false)
      const db = new Database(dbPath)
      db.exec('DELETE FROM disease_null WHERE disease = (SELECT MIN(disease) FROM disease_null)')
      db.close()
      expect(readHpoDataStatus(dbPath).needsUpdate).toBe(true)
    } finally {
      config.backgroundCorrection = 'off'
    }
  })

  it('prewarms the index without throwing on missing or damaged files', () => {
    expect(prewarmHpoIndex(join(dir, 'missing.db'))).toBe(false)
    build()
    expect(prewarmHpoIndex(dbPath)).toBe(true)
    writeFileSync(dbPath, 'not a database at all, just bytes '.repeat(200))
    expect(prewarmHpoIndex(dbPath)).toBe(false)
  })

  it('prewarms the index so the first scorer does not read the file, and never throws', () => {
    expect(() => prewarmHpoIndex(null)).not.toThrow()
    expect(() => prewarmHpoIndex(join(dir, 'missing.db'))).not.toThrow()
    writeFileSync(dbPath, 'not a database at all, just bytes '.repeat(200))
    expect(() => prewarmHpoIndex(dbPath)).not.toThrow()
    rmSync(dbPath)
    build()
    prewarmHpoIndex(dbPath)
    const open = vi.spyOn(Database.prototype, 'prepare')
    expect(openHpoGeneScorer([T.C], dbPath)?.score('GENE2')).not.toBeNull()
    expect(open).not.toHaveBeenCalled()
    open.mockRestore()
  })

  it('has no scorer without patient terms or data', () => {
    build()
    expect(openHpoGeneScorer([], dbPath)).toBeNull()
    expect(openHpoGeneScorer([P(T.C)], join(dir, 'missing.db'))).toBeNull()
  })

  it('treats a damaged file as "needs update" and scores nothing, without throwing', () => {
    writeFileSync(dbPath, 'not a database at all, just bytes '.repeat(200))
    expect(readHpoDataStatus(dbPath)).toMatchObject({ installed: false, needsUpdate: true })
    expect(openHpoGeneScorer([P(T.C)], dbPath)).toBeNull()
  })

  it('reports a DB from an older builder as needing an update', () => {
    build()
    const db = new Database(dbPath)
    db.prepare("UPDATE meta SET value = '2' WHERE key = 'builder_version'").run()
    db.close()
    expect(readHpoDataStatus(dbPath)).toMatchObject({ installed: true, needsUpdate: true })
  })
})
