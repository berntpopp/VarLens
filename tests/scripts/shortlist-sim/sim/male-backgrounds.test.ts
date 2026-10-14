// Male backgrounds (#583): sex inference, case sex in the DB, hemizygous XL spikes.
import { describe, expect, it } from 'vitest'
import {
  describeBackground,
  inferSex,
  openBackgroundDb,
  SEX_INFERENCE
} from '../../../../scripts/shortlist-sim/sim/background-db'
import { buildCases } from '../../../../scripts/shortlist-sim/sim/cases'
import type { SpikeSource } from '../../../../scripts/shortlist-sim/sim/spikes'
import { GENES, onChrX, poolSpike, SPIKE_OPTIONS, syntheticBackground, withChrX } from './fixtures'

const MALE_GTS = Array.from({ length: 20 }, (_, i) => (i === 0 ? '0/1' : i % 2 ? '1/1' : '1'))
const FEMALE_GTS = Array.from({ length: 20 }, (_, i) => (i % 3 ? '0/1' : '1/1'))

describe('inferSex', () => {
  it('calls male from a low chrX non-PAR het share, female from a high one', () => {
    expect(inferSex(withChrX(syntheticBackground(), MALE_GTS).rows)).toBe('male')
    expect(inferSex(withChrX(syntheticBackground(), FEMALE_GTS).rows)).toBe('female')
  })

  it('makes no call with too few chrX calls (autosomes and PAR ignored)', () => {
    expect(inferSex(syntheticBackground().rows)).toBeNull()
    const few = MALE_GTS.slice(0, SEX_INFERENCE.minCalls - 1)
    expect(inferSex(withChrX(syntheticBackground(), few).rows)).toBeNull()
    const par = withChrX(syntheticBackground(), MALE_GTS)
    const inPar = par.rows.map((r) => (r.chr === 'X' ? { ...r, pos: 100_000 } : r))
    expect(inferSex(inPar)).toBeNull()
  })

  it('writes the inferred sex to case_metadata for the production ranking', () => {
    const db = openBackgroundDb(withChrX(syntheticBackground('m1'), MALE_GTS), 'primary', 1)
    expect(db.sex).toBe('male')
    expect(db.repos.metadata.getCaseMetadata(db.caseId)?.sex).toBe('male')
    db.db.close()
  })
})

describe('XL spikes in a male background', () => {
  const bg = withChrX(syntheticBackground('male'), MALE_GTS)
  const info = describeBackground(bg.caseLabel, bg.rows)
  const sources = new Map<string, SpikeSource>()
  const add = (s: SpikeSource): SpikeSource => (sources.set(s.pv.key, s), s)
  add(onChrX(poolSpike('GENE1', { moi: 'XLR' })))
  add(onChrX(poolSpike('GENE1', { moi: 'XLD' })))
  for (let i = 0; i < 20; i++)
    add(poolSpike(GENES[5 + i], { label: 'benign', moi: null }, 'synonymous_variant', 0.001))
  const pool = [...sources.values()].map((s) => s.pv)
  const build = buildCases(pool, sources, [{ info, normKeys: new Set() }], 7, SPIKE_OPTIONS)

  it('samples hemizygous encodings from the background chrX non-PAR alt calls', () => {
    expect(new Set(info.encodings['snv:hemi'].map(([gt]) => gt))).toEqual(new Set(['1/1', '1']))
  })

  it('simulates XLR and XLD as hemizygous calls in varvis encoding', () => {
    expect(build.funnel.causal_xlr_not_simulated).toBeUndefined()
    expect(build.funnel.cases_XLR).toBe(1)
    const xl = build.cases.filter((c) => c.mode === 'XLR' || c.mode === 'XLD')
    expect(xl.map((c) => c.mode).sort()).toEqual(['XLD', 'XLR'])
    for (const c of xl) expect(['1/1', '1']).toContain(c.causal[0].row.gt_num)
  })

  it('keeps an XL allele in a PAR diploid (het) in a male background', () => {
    const par = onChrX(poolSpike('GENE1', { moi: 'XLD' }), 'GENEX', 1_500_000)
    const benign = [...sources].filter(([, s]) => s.pv.label === 'benign')
    const parSources = new Map([[par.pv.key, par], ...benign])
    const parBuild = buildCases(
      [...parSources.values()].map((s) => s.pv),
      parSources,
      [{ info, normKeys: new Set() }],
      7,
      SPIKE_OPTIONS
    )
    expect(parBuild.cases.find((c) => c.mode === 'XLD')!.causal[0].row.gt_num).toMatch(
      /0\/1|\.\/1|1\/\./
    )
  })

  it('still skips XLR in a female background (counted)', () => {
    const female = withChrX(syntheticBackground('female'), FEMALE_GTS)
    const fInfo = describeBackground(female.caseLabel, female.rows)
    const fBuild = buildCases(
      pool,
      sources,
      [{ info: fInfo, normKeys: new Set() }],
      7,
      SPIKE_OPTIONS
    )
    expect(fBuild.funnel.causal_xlr_not_simulated).toBe(1)
    expect(fBuild.cases.find((c) => c.mode === 'XLD')!.causal[0].row.gt_num).toMatch(
      /0\/1|\.\/1|1\/\./
    )
  })
})
