import { describe, expect, it } from 'vitest'
import {
  buildPhenotypeIndex,
  type PhenotypeIndexInput
} from '../../../src/shared/phenotype/phenotype-index'
import { nullParams, scoringOptions } from '../../../src/shared/phenotype/phenotype-calibration'
import { HPO_SCORING_CONFIG } from '../../../src/shared/config/hpo-scoring.config'
import {
  explainDisease,
  explainGene,
  scoreCase
} from '../../../src/shared/phenotype/phenotype-score'

// Seeded random index (CNV/STR spec §4.1, §6.1): many genes, so ties and ranks are exercised.
function fixture(): { ix: ReturnType<typeof buildPhenotypeIndex>; input: PhenotypeIndexInput } {
  let seed = 0x5eed
  const rand = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000
  const int = (n: number): number => Math.floor(rand() * n)
  const ids = ['HP:0000118', ...Array.from({ length: 40 }, (_, i) => `T${i}`)]
  const input: PhenotypeIndexInput = {
    terms: ids.map((id, i) => ({ id, ic: i === 0 ? 0 : 1 + rand() * 4, label: id })),
    edges: ids.slice(1).map((id, i) => [id, ids[int(i + 1)]] as const),
    aliases: [],
    diseases: Array.from({ length: 80 }, (_, d) => [`D${d}`, `disease ${d}`] as const),
    diseaseTerms: [],
    diseaseNot: [],
    geneDiseases: []
  }
  const terms = input.diseaseTerms as Array<readonly [string, string, number, number]>
  const genes = input.geneDiseases as Array<readonly [string, string]>
  for (let d = 0; d < 80; d++) {
    for (const t of new Set(Array.from({ length: 1 + int(6) }, () => ids[1 + int(40)]))) {
      terms.push([`D${d}`, t, [0.17, 0.545, 0.895, 1][int(4)], 0.1])
    }
  }
  // D70..D79 are linked to no gene, like admitted region and STR diseases.
  for (let g = 0; g < 200; g++) {
    for (const d of new Set(Array.from({ length: 1 + int(3) }, () => int(70)))) {
      genes.push([`G${g}`, `D${d}`])
    }
  }
  return { ix: buildPhenotypeIndex(input), input }
}

const PROFILE = ['T3', 'T11', 'T27', 'T38'].map((hpoId, i) => ({
  hpoId,
  excluded: i === 3,
  key: i === 0
}))

describe('locus scoring contracts', () => {
  const { ix } = fixture()
  const cs = scoreCase(ix, PROFILE)!

  it('explainGene output is unchanged (SNV invariance)', () => {
    // One JSON line per gene keeps the snapshot readable.
    const lines = [...ix.genes.values()].map((g) => JSON.stringify(explainGene(ix, cs, g)))
    expect(lines).toMatchSnapshot()
  })

  it('explainDisease explains a gene-less disease and equals explainGene for a best disease', () => {
    const d = ix.diseaseIds.indexOf('D75')
    const e = explainDisease(ix, cs, d)
    expect(e).toMatchObject({ diseaseId: 'D75', score: cs.diseaseScore[d] })
    expect(e.percentile).toBeGreaterThanOrEqual(0)
    const g = ix.genes.get('G0')!
    expect(explainDisease(ix, cs, cs.geneBest[g])).toEqual(explainGene(ix, cs, g))
  })

  it('z mode: admitting gene-less diseases leaves every gene score unchanged', () => {
    const { input } = fixture()
    const K = HPO_SCORING_CONFIG.nullMaxK
    // Gene-less diseases get σ = 0: calibrated over all diseases, the 5 % σ floor would drop to 0.
    const withNull = (keep: (d: string) => boolean): PhenotypeIndexInput => ({
      ...input,
      diseases: input.diseases.filter(([d]) => keep(d)),
      diseaseTerms: input.diseaseTerms.filter(([d]) => keep(d)),
      diseaseNull: input.diseases
        .filter(([d]) => keep(d))
        .map(([d], i) => {
          const sd = Number(d.slice(1)) >= 70 ? 0 : 0.01 * (1 + i)
          return [d, new Float32Array(K).fill(0.2), new Float32Array(K).fill(sd)] as const
        }),
      nullParams: nullParams(HPO_SCORING_CONFIG.tau)
    })
    const genesOnly = buildPhenotypeIndex(withNull((d) => Number(d.slice(1)) < 70))
    const admitted = buildPhenotypeIndex(withNull(() => true))
    // Penalty mode reads the exclusion background b_e of the excluded term.
    const z = scoringOptions({ correction: 'z', exclusionMode: 'penalty' })
    const before = scoreCase(genesOnly, PROFILE, z)!
    const after = scoreCase(admitted, PROFILE, z)!
    for (const [gene, g] of genesOnly.genes) {
      expect(after.geneScore[admitted.genes.get(gene)!]).toBe(before.geneScore[g])
    }
  })
})
