import Database from 'better-sqlite3-multiple-ciphers'
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
  readLocusReference,
  type LocusSourceInput
} from '../../../../src/main/services/phenotype/locus-reference-db'
import { HPO_SCORING_CONFIG } from '../../../../src/shared/config/hpo-scoring.config'
import type { HpoProfileTerm } from '../../../../src/shared/types/hpo-profile'
import {
  GENES_TO_PHENOTYPE,
  HP_JSON,
  PHENOTYPE_HPOA,
  T
} from '../../../shared/phenotype/hpo-fixture'
import {
  clingenGenes,
  clingenRegions,
  ENTREZ_TO_HGNC,
  MONDO_OBO,
  STRCHIVE_LOCI
} from '../../../shared/phenotype/locus-fixture'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'locus-db-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const VERSIONS = { clingen: '2026-10-14', strchive: 'v2.28.0', mondo: 'v2026-10-06' }
const input = (over: Partial<LocusSourceInput> = {}): LocusSourceInput => ({
  clingen: {
    genes: clingenGenes(),
    regions: { GRCh37: clingenRegions(), GRCh38: clingenRegions() }
  },
  strchive: STRCHIVE_LOCI,
  mondo: MONDO_OBO,
  versions: { ...VERSIONS },
  errors: {},
  entrezToHgnc: ENTREZ_TO_HGNC,
  previousPath: null,
  ...over
})
const build = (
  name: string,
  locus?: LocusSourceInput,
  nullTau: number | null = null
): { path: string; warnings: string[] } => {
  const path = join(dir, name)
  const warnings = buildHpoSimilarityDb(
    { ontology: HP_JSON, annotations: PHENOTYPE_HPOA, genes: GENES_TO_PHENOTYPE, locus },
    { release: 'v2026-09-01', sha256: {} },
    path,
    nullTau
  )
  return { path, warnings }
}
const all = (path: string, sql: string): unknown[] => {
  const db = new Database(path, { readonly: true })
  try {
    return db.prepare(sql).raw().all()
  } finally {
    db.close()
  }
}
const PROFILE: HpoProfileTerm[] = [T.C, T.D, T.E].map((hpoId) => ({
  hpoId,
  excluded: false,
  key: false
}))

describe('locus reference build', () => {
  it('admits region and STR diseases without touching gene links or gene scores', () => {
    const plain = build('plain.db')
    const full = build('full.db', input())
    expect(full.warnings).toEqual([])
    const genes = 'SELECT * FROM gene_diseases ORDER BY 1, 2'
    expect(all(full.path, genes)).toEqual(all(plain.path, genes))
    // OMIM:1 is unlinked in HPOA; region ISCA-1 (HI 3) names it through Mondo.
    expect(all(plain.path, "SELECT id FROM diseases WHERE id = 'OMIM:1'")).toEqual([])
    expect(all(full.path, "SELECT id FROM diseases WHERE id = 'OMIM:1'")).toEqual([['OMIM:1']])

    const before = openHpoGeneScorer(PROFILE, plain.path)!
    const after = openHpoGeneScorer(PROFILE, full.path)!
    for (const gene of ['GENE1', 'GENE2', 'GENE3']) {
      expect(after.score(gene)).toBe(before.score(gene))
      expect(after.bestDisease(gene)).toBe(before.bestDisease(gene))
    }
    expect(before.scoreDiseases(['OMIM:1'])).toBeNull()
    expect(after.scoreDiseases(['OMIM:1'])?.disease).toBe('OMIM:1')

    // z mode: σ floors and the exclusion background are calibrated over gene-linked diseases only.
    const tau = HPO_SCORING_CONFIG.tau
    const [plainZ, fullZ] = [build('plain-z.db', undefined, tau), build('full-z.db', input(), tau)]
    const withExcluded = [...PROFILE, { hpoId: T.F, excluded: true, key: false }]
    const z = (path: string) => openHpoGeneScorer(withExcluded, path, { correction: 'z' })!
    for (const gene of ['GENE1', 'GENE2', 'GENE3']) {
      expect(z(fullZ.path).score(gene)).toBe(z(plainZ.path).score(gene))
    }
  })

  it('stores versions and the normalised reference', () => {
    const { path } = build('full.db', input())
    expect(readHpoDataStatus(path).sources).toEqual({ hpo: 'v2026-09-01', ...VERSIONS })
    const ref = readLocusReference(path)!
    expect(ref.dosageGenes.get('HGNC:2')).toEqual({
      hgncId: 'HGNC:2',
      symbol: 'GENE2',
      hi: 30,
      ts: null
    })
    expect(
      ref.dosageRegions.find((r) => r.iscaId === 'ISCA-1' && r.build === 'GRCh37')
    ).toMatchObject({ chr: '16', start: 100, end: 200, hi: 3, lossDiseases: ['OMIM:1', 'ORPHA:9'] })
    // DM1 has only a MONDO id (→ OMIM:3); the override adds ORPHA:273.
    expect(ref.strLoci.find((l) => l.id === 'DM1_DMPK')?.diseases.full).toEqual([
      'OMIM:3',
      'ORPHA:273'
    ])
    expect(ref.sources.strchive).toBe('v2.28.0')
  })

  it('keeps the installed copy of a failed source, and names it', () => {
    const first = build('first.db', input())
    const { path, warnings } = build(
      'second.db',
      input({
        strchive: undefined,
        clingen: { genes: clingenGenes(3), regions: {} },
        versions: { mondo: 'v2026-11-01', clingen: '2026-11-01' },
        errors: { strchive: 'Checksum mismatch for STRchive-loci-v2.29.0.json' },
        previousPath: first.path
      })
    )
    expect(warnings).toEqual([
      expect.stringMatching(/^ClinGen: .*fewer than .*; kept 2026-10-14$/),
      'STRchive: Checksum mismatch for STRchive-loci-v2.29.0.json; kept v2.28.0'
    ])
    expect(readHpoDataStatus(path).sources).toEqual({
      hpo: 'v2026-09-01',
      clingen: '2026-10-14',
      strchive: 'v2.28.0',
      mondo: 'v2026-11-01'
    })
    const ref = readLocusReference(path)!
    expect(ref.strLoci).toHaveLength(6)
    expect(ref.dosageGenes.size).toBe(1000)
    // The fresh Mondo still carries the crosswalk of the kept regions.
    expect(all(path, 'SELECT mondo FROM mondo_xrefs ORDER BY 1')).toEqual([
      ['MONDO:0000001'],
      ['MONDO:0000002']
    ])
    expect(all(path, "SELECT id FROM diseases WHERE id = 'OMIM:1'")).toEqual([['OMIM:1']])
  })

  it('leaves a failed source empty without an installed copy', () => {
    const { path, warnings } = build(
      'only.db',
      input({ mondo: undefined, errors: { mondo: 'HTTP 503' }, versions: VERSIONS })
    )
    expect(warnings).toEqual(['Mondo: HTTP 503; unavailable'])
    expect(readHpoDataStatus(path).sources).not.toHaveProperty('mondo')
    // Without Mondo the region's MONDO id maps to nothing.
    expect(readLocusReference(path)!.dosageRegions[0].lossDiseases).toEqual([])
  })

  it('refuses a catalogue missing an overridden locus', () => {
    const loci = (JSON.parse(STRCHIVE_LOCI) as Array<{ id: string }>).filter(
      (l) => l.id !== 'HD_HTT'
    )
    const { warnings } = build('x.db', input({ strchive: JSON.stringify(loci) }))
    expect(warnings).toEqual(['STRchive: overrides name unknown loci: HD_HTT; unavailable'])
  })

  it('reads null for a DB without locus tables', () => {
    const { path } = build('plain.db')
    const db = new Database(path)
    db.exec('DROP TABLE str_loci')
    db.close()
    expect(readLocusReference(path)).toBeNull()
    expect(readLocusReference(join(dir, 'missing.db'))).toBeNull()
  })
})
