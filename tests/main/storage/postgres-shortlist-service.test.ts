import { describe, expect, it, vi } from 'vitest'

import { PostgresShortlistService } from '../../../src/main/storage/postgres/PostgresShortlistService'
import type { ShortlistConfig } from '../../../src/shared/types/shortlist'
import type { Variant } from '../../../src/shared/types/database'
import { ShortlistQueryError } from '../../../src/main/database/ShortlistService'
import { PanelRegionsUnavailableError } from '../../../src/shared/filters/panel-intervals'

const CONFIG: ShortlistConfig = {
  variantTypeScope: ['snv'],
  baseFilters: {
    consequences: ['HIGH'],
    maxGnomadAf: 0.01
  },
  topN: 5,
  rankConfig: {
    weights: { impact: 1, pathogenicity: 1, rarity: 1, clinvar: 1, phenotype: 0 },
    pinStarredTop: true
  }
}

function variant(overrides: Partial<Variant>): Variant {
  return {
    id: 1,
    case_id: 1,
    chr: '1',
    pos: 100,
    ref: 'A',
    alt: 'T',
    gene_symbol: 'GENE1',
    omim_mim_number: null,
    consequence: 'HIGH',
    gnomad_af: 0.001,
    cadd: 30,
    clinvar: 'Pathogenic',
    gt_num: '0/1',
    func: 'stop_gained',
    qual: null,
    hpo_sim_score: null,
    transcript: null,
    cdna: null,
    aa_change: null,
    moi: null,
    gq: null,
    dp: null,
    ad_ref: null,
    ad_alt: null,
    ab: null,
    filter: null,
    info_json: null,
    source_format: 'vcf',
    variant_type: 'snv',
    ...overrides
  }
}

describe('PostgresShortlistService', () => {
  it('queries PostgreSQL variants with exact per-type scope and returns ranked rows', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [{ variant_id: 2, starred: 1 }] })
    }
    const variants = {
      queryVariants: vi.fn().mockResolvedValue({
        data: [
          variant({ id: 1, cadd: 10, clinvar: null }),
          variant({ id: 2, cadd: 40, clinvar: 'Pathogenic' })
        ],
        total_count: 0
      })
    }
    const service = new PostgresShortlistService({
      pool: pool as never,
      schema: 'public',
      filterPresets: { getPreset: vi.fn() },
      variants: variants as never
    })

    const result = await service.getShortlist({ caseId: 1, adHocConfig: CONFIG })

    expect(variants.queryVariants).toHaveBeenCalledWith(
      expect.objectContaining({
        case_id: 1,
        variant_type: 'snv',
        exact_variant_type: true,
        consequences: ['HIGH'],
        gnomad_af_max: 0.01
      }),
      20,
      0,
      [{ key: 'id', order: 'asc' }],
      true,
      false
    )
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('case_variant_annotations'), [
      1,
      [1, 2]
    ])
    expect(result.totalCandidates).toBe(2)
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]).toMatchObject({
      id: 2,
      rank: 1,
      is_starred: true,
      rank_starred_pinned: true
    })
  })

  it('rethrows a refused panel filter as-is and aggregates other failures', async () => {
    const make = (error: Error): PostgresShortlistService =>
      new PostgresShortlistService({
        pool: { query: vi.fn() } as never,
        schema: 'public',
        filterPresets: { getPreset: vi.fn() },
        variants: { queryVariants: vi.fn().mockRejectedValue(error) } as never
      })

    const refused = new PanelRegionsUnavailableError(3, 'GRCh37')
    await expect(make(refused).getShortlist({ caseId: 1, adHocConfig: CONFIG })).rejects.toBe(
      refused
    )
    await expect(
      make(new Error('connection lost')).getShortlist({ caseId: 1, adHocConfig: CONFIG })
    ).rejects.toBeInstanceOf(ShortlistQueryError)
  })
})
