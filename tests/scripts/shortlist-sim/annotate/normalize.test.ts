import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BCFTOOLS, GRCH38_FASTA } from '../../../../scripts/shortlist-sim/common/paths'
import { normalizeAlleles } from '../../../../scripts/shortlist-sim/annotate/normalize'

const available = existsSync(BCFTOOLS) && existsSync(GRCH38_FASTA)
if (!available) console.warn(`normalize tests skipped: need ${BCFTOOLS} and ${GRCH38_FASTA}`)

// GRCh38 1:1000000-1000059 (public reference sequence).
const START = 1_000_000
const WINDOW = 'GGTGGAGCGCGCCGCCACGGACCACGGGCGGGCTGGCGGGCGAGCGGCGAGCGCGCGGCG'

describe.skipIf(!available)('normalizeAlleles (bcftools norm)', () => {
  it('left-aligns a right-shifted homopolymer deletion, keeps a correct SNV, flags a REF mismatch', async () => {
    const seq = WINDOW
    const run = /(.)\1{2,}/.exec(seq.slice(1))! // homopolymer of >= 3 with a preceding anchor base
    const first = run.index + 1 // offset of the run's first base
    const last = first + run[0].length - 1
    const base = run[1]
    const snvRef = seq[40]
    const wrongRef = snvRef === 'A' ? 'C' : 'A'
    const out = await normalizeAlleles([
      { key: 'del', chr: 'chr1', pos: START + last - 1, ref: base + base, alt: base },
      { key: 'snv', chr: '1', pos: START + 40, ref: snvRef, alt: snvRef === 'G' ? 'T' : 'G' },
      { key: 'bad', chr: '1', pos: START + 40, ref: wrongRef, alt: 'T' },
      { key: 'multi', chr: '1', pos: START + 40, ref: snvRef, alt: 'G,T' }
    ])
    const anchor = seq[first - 1]
    expect(out[0]).toMatchObject({
      status: 'ok',
      pos: START + first - 1,
      ref: anchor + base,
      alt: anchor
    })
    expect(out[0].key).toBe(`1:${START + first - 1}:${anchor + base}:${anchor}`)
    expect(out[1]).toMatchObject({ status: 'ok', pos: START + 40, ref: snvRef })
    expect(out[2].status).toBe('ref_mismatch')
    expect(out[3].status).toBe('multiallelic')
  }, 300_000) // the FASTA sits on a CIFS share; bcftools can be slow under load
})
