import { describe, expect, it } from 'vitest'
import { rng } from '../../../../scripts/shortlist-sim/common/rng'
import {
  describeBackground,
  openBackgroundDb
} from '../../../../scripts/shortlist-sim/sim/background-db'
import { buildCases, DECOYS_PER_CASE } from '../../../../scripts/shortlist-sim/sim/cases'
import {
  applyScenarioToBackground,
  applyScenarioToSpike
} from '../../../../scripts/shortlist-sim/sim/scenarios'
import { spikeRow, type SpikeSource } from '../../../../scripts/shortlist-sim/sim/spikes'
import { annotationSeverityRanks } from '../../../../src/shared/config'
import { GENES, poolSpike, SPIKE_OPTIONS, syntheticBackground } from './fixtures'

const bg = syntheticBackground()
const info = describeBackground(bg.caseLabel, bg.rows)
const noNorm = new Set<string>()

describe('openBackgroundDb', () => {
  it('holds every mapped row with production severity ranks', () => {
    const db = openBackgroundDb(bg, 'clinvar_visible', 1)
    const rows = db.db
      .prepare('SELECT consequence, clinvar, impact_rank, clinvar_rank FROM variants ORDER BY id')
      .all() as Array<{
      consequence: string
      clinvar: string | null
      impact_rank: number
      clinvar_rank: number
    }>
    expect(rows).toHaveLength(bg.rows.length)
    for (const r of rows) {
      const want = annotationSeverityRanks(r)
      expect([r.impact_rank, r.clinvar_rank]).toEqual([want.impact_rank, want.clinvar_rank])
    }
    db.db.close()
  })
})

describe('scenarios', () => {
  it('primary masks ClinVar on background and spike rows; visible keeps it', () => {
    expect(
      applyScenarioToBackground(bg.rows, 'primary', rng(1)).every((r) => r.clinvar === null)
    ).toBe(true)
    expect(
      applyScenarioToBackground(bg.rows, 'clinvar_visible', rng(1)).some((r) => r.clinvar !== null)
    ).toBe(true)
    const spike = spikeRow(poolSpike('GENE1'), 'causal', info, noNorm, 'het', rng(2), SPIKE_OPTIONS)
    if (typeof spike === 'string') throw new Error(spike)
    expect(spike.row.clinvar).toBe('Pathogenic')
    expect(applyScenarioToSpike(spike.row, 'primary', info, rng(3)).clinvar).toBeNull()
  })

  it('pheno_free nulls hpo_sim_score everywhere', () => {
    const rows = applyScenarioToBackground(bg.rows, 'pheno_free', rng(1))
    expect(rows.every((r) => r.hpo_sim_score === null)).toBe(true)
  })

  it('pheno_shuffled permutes gene-level scores (multiset kept, constant within gene)', () => {
    const rows = applyScenarioToBackground(bg.rows, 'pheno_shuffled', rng(5))
    const before = describeBackground('x', bg.rows).geneFields
    const after = describeBackground('x', rows).geneFields
    const scores = (m: typeof before): Array<number | null> =>
      [...m.values()].map((g) => g.hpo_sim_score).sort()
    expect(scores(after)).toEqual(scores(before))
    expect(
      [...after.entries()].some(([g, f]) => f.hpo_sim_score !== before.get(g)!.hpo_sim_score)
    ).toBe(true)
    for (const r of rows) expect(r.hpo_sim_score).toBe(after.get(r.gene_symbol!)!.hpo_sim_score)
  })
})

describe('spikeRow', () => {
  it('returns collision for a background allele (normalised or production identity)', () => {
    const r = bg.rows[0]
    const src = poolSpike('GENE0')
    const clash: SpikeSource = {
      ...src,
      norm: { ...src.norm, chr: r.chr, pos: r.pos, ref: r.ref, alt: r.alt, key: 'other' }
    }
    expect(spikeRow(clash, 'causal', info, noNorm, 'het', rng(1), SPIKE_OPTIONS)).toBe('collision')
    expect(
      spikeRow(src, 'causal', info, new Set([src.norm.key]), 'het', rng(1), SPIKE_OPTIONS)
    ).toBe('collision')
  })

  it('copies gene fields and never builds a spike in an absent gene', () => {
    const s = spikeRow(poolSpike('GENE3'), 'causal', info, noNorm, 'het', rng(1), SPIKE_OPTIONS)
    if (typeof s === 'string') throw new Error(s)
    expect(s.row.moi).toBe(info.geneFields.get('GENE3')!.moi)
    expect(s.row.omim_mim_number).toBe(info.geneFields.get('GENE3')!.omim_mim_number)
    expect(s.row.func).toBe('stop_gained')
    expect(s.row.consequence).toBe('HIGH')
    expect(s.row.cadd).toBe(31)
    const absent = poolSpike('GENE3')
    expect(
      spikeRow(
        { ...absent, pv: { ...absent.pv, gene: 'NOPE' } },
        'causal',
        info,
        noNorm,
        'het',
        rng(1),
        SPIKE_OPTIONS
      )
    ).toBe('gene_absent')
  })

  it('samples het encodings with the background share of ./1 and 1/.', () => {
    const bgHets = info.encodings['snv:het'].map(([gt]) => gt)
    const share = (gts: Array<string | null>): number =>
      gts.filter((g) => g === './1' || g === '1/.').length / gts.length
    const rnd = rng(9)
    const src = poolSpike('GENE2', {}, 'missense_variant')
    const gts = Array.from({ length: 10_000 }, () => {
      const s = spikeRow(src, 'causal', info, noNorm, 'het', rnd, SPIKE_OPTIONS)
      if (typeof s === 'string') throw new Error(s)
      return s.row.gt_num
    })
    expect(Math.abs(share(gts) - share(bgHets))).toBeLessThan(0.01)
  })

  it('imputes indel CADD from varvis rows of the same func and class, nulls included', () => {
    const src = poolSpike('GENE4', {}, 'missense_variant')
    const indel: SpikeSource = {
      ...src,
      caddApi: undefined,
      norm: { ...src.norm, ref: 'C', alt: 'CAT', key: src.norm.key + 'AT' }
    }
    const pool = info.caddByFuncClass.get('missense_variant|indel')!
    expect(pool.length).toBeGreaterThan(0)
    const s = spikeRow(indel, 'causal', info, noNorm, 'het', rng(4), SPIKE_OPTIONS)
    if (typeof s === 'string') throw new Error(s)
    expect(s.caddSource).toBe('imputed')
    expect(pool).toContain(s.row.cadd)
    const off = spikeRow(indel, 'causal', info, noNorm, 'het', rng(4), {
      ...SPIKE_OPTIONS,
      caddImpute: false
    })
    expect(typeof off !== 'string' && off.row.cadd).toBeNull()
  })
})

describe('buildCases', () => {
  const sources = new Map<string, SpikeSource>()
  const add = (s: SpikeSource): SpikeSource => (sources.set(s.pv.key, s), s)
  const ar1 = add(poolSpike('GENE0', { moi: 'AR', diseaseIds: ['OMIM:9'] }))
  const ar2 = add(poolSpike('GENE0', { moi: 'AR', diseaseIds: ['OMIM:9'] }))
  add(poolSpike('GENE0', { moi: 'AR', diseaseIds: ['OMIM:8'] }))
  add(poolSpike('GENE1', { moi: 'AD' }))
  add(poolSpike('GENE1', { moi: 'AD' }, 'stop_gained', 0.01)) // implausible for AD
  add(poolSpike('GENE2', { moi: 'XLR' }))
  add(poolSpike('GENE2', { moi: 'XLD' }))
  add(poolSpike('ABSENT', { moi: 'AD' }))
  for (let i = 0; i < 20; i++)
    add(
      poolSpike(
        GENES[5 + i],
        { label: 'benign', moi: null, clnsig: 'Benign' },
        'synonymous_variant',
        0.001
      )
    )
  const pool = [...sources.values()].map((s) => s.pv)
  const build = buildCases(pool, sources, [{ info, normKeys: noNorm }], 7, SPIKE_OPTIONS)

  it('builds single-allele cases per MOI, drops implausible AF and XLR (counted)', () => {
    const modes = build.cases.map((c) => c.mode).sort()
    expect(modes).toEqual(['AD', 'AR_COMPHET', 'AR_HOM', 'AR_HOM', 'AR_HOM', 'XLD'])
    expect(build.funnel.causal_xlr_not_simulated).toBe(1)
    expect(build.funnel.causal_freq_implausible).toBe(1)
    expect(build.cases.every((c) => info.genes.has(c.gene))).toBe(true)
    for (const c of build.cases.filter((x) => x.mode === 'AR_HOM'))
      expect(c.causal[0].row.gt_num).toMatch(/1\/1|1\|1/)
  })

  it('pairs compound hets from the same disease, both het, different keys', () => {
    const pair = build.cases.find((c) => c.mode === 'AR_COMPHET')!
    expect(new Set(pair.causal.map((s) => s.poolKey))).toEqual(new Set([ar1.pv.key, ar2.pv.key]))
    expect(pair.causal[0].key).not.toBe(pair.causal[1].key)
    for (const s of pair.causal) expect(['0/1', './1', '1/.']).toContain(s.row.gt_num)
  })

  it('adds exactly 10 benign decoys from other background genes', () => {
    for (const c of build.cases) {
      expect(c.decoys).toHaveLength(DECOYS_PER_CASE)
      for (const d of c.decoys) {
        expect(d.row.clinvar).toBe('Benign')
        expect(info.genes.has(d.row.gene_symbol!)).toBe(true)
        expect(d.row.gene_symbol).not.toBe(c.gene)
      }
    }
  })
})
