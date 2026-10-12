import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildPool } from '../../../../scripts/shortlist-sim/pool/select-pool'
import { parseOriginBits } from '../../../../scripts/shortlist-sim/pool/clinvar-vcf'
import { rng } from '../../../../scripts/shortlist-sim/common/rng'

const DATA = resolve(process.cwd(), 'tests/test-data/shortlist-sim')
const build = (seed = 1) =>
  buildPool({
    clinvar: `${DATA}/clinvar-mini.vcf.txt`,
    clinvar2024: `${DATA}/clinvar-mini-2024.vcf.txt`,
    hpoa: `${DATA}/hpoa-mini.tsv`,
    seed
  })

describe('parseOriginBits', () => {
  it('reads the bit labels from the real ClinVar header text', () => {
    const bits = parseOriginBits(
      '##INFO=<ID=ORIGIN,Number=.,Type=String,Description="Allele origin. One or more of the following values may be added: 0 - unknown; 1 - germline; 2 - somatic; 4 - inherited; 32 - de-novo; 1073741824 - other">'
    )
    expect([...bits]).toEqual([
      [0, 'unknown'],
      [1, 'germline'],
      [2, 'somatic'],
      [4, 'inherited'],
      [32, 'de-novo'],
      [1073741824, 'other']
    ])
  })
})

describe('buildPool', () => {
  it('keeps exactly the eligible records with their MOI', async () => {
    const pool = await build()
    const plp = pool.variants.filter((v) => v.label === 'plp')
    const byKey = Object.fromEntries(plp.map((v) => [v.key, v.moi]))
    expect(byKey['1:1000:A:G']).toBe('AD')
    expect(byKey['1:2000:C:T']).toBe('AR')
    expect(byKey['X:5000:T:C']).toBe('XLR')
    expect(byKey['X:6000:TA:T']).toBe('XLD')
    expect(plp.filter((v) => v.gene === 'GENEC')).toHaveLength(3)
    expect(plp).toHaveLength(7)
    expect(pool.variants.filter((v) => v.label === 'benign').map((v) => v.key)).toEqual([
      '1:4000:G:A'
    ])
    expect(pool.variants.find((v) => v.key === 'X:6000:TA:T')?.diseaseIds).toEqual(['ORPHA:300'])
  })

  it('marks the temporal stratum against the archived release', async () => {
    const pool = await build()
    const get = (k: string) => pool.variants.find((v) => v.key === k)
    expect(get('1:1000:A:G')?.newSince2024).toBe(false)
    expect(get('1:2000:C:T')?.newSince2024).toBe(true) // VUS in 2024
  })

  it('reports every funnel counter', async () => {
    const pool = await build()
    expect(pool.clinvarRelease).toBe('2026-04-26')
    expect(pool.hpoaRelease).toBe('2026-09-02')
    expect(pool.funnel).toEqual({
      records: 20,
      plp_clnsig: 17,
      plp_drop_review: 1,
      plp_drop_origin: 3,
      plp_drop_gene: 1,
      plp_drop_size: 1,
      plp_drop_disease: 1,
      plp_drop_moi_ambiguous: 1,
      plp_drop_moi_none: 1,
      plp_eligible: 8,
      plp_eligible_genes: 5,
      plp_after_gene_cap: 7,
      plp_sampled_AD: 4,
      plp_sampled_AR: 1,
      plp_sampled_XLD: 1,
      plp_sampled_XLR: 1,
      plp_sampled_new_since_2024: 6,
      benign_clnsig: 1,
      benign_eligible: 1,
      benign_eligible_genes: 1,
      benign_after_gene_cap: 1,
      benign_sampled: 1
    })
  })

  it('is deterministic per seed', async () => {
    const a = await build(7)
    const b = await build(7)
    expect(a.variants.map((v) => v.key)).toEqual(b.variants.map((v) => v.key))
    expect(rng(1)()).toBe(rng(1)())
  })
})
