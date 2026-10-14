import { describe, expect, it } from 'vitest'
import {
  buildPhenotypeIndex,
  type PhenotypeIndexInput
} from '../../../src/shared/phenotype/phenotype-index'
import { explainGene, scoreCase } from '../../../src/shared/phenotype/phenotype-score'

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
})
