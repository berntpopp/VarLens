import { describe, expect, it, vi } from 'vitest'

import { PostgresShortlistService } from '../../../src/main/storage/postgres/PostgresShortlistService'
import type { ShortlistConfig } from '../../../src/shared/types/shortlist'
import type { Variant } from '../../../src/shared/types/database'
import { ShortlistQueryError } from '../../../src/main/database/ShortlistService'
import { PanelRegionsUnavailableError } from '../../../src/shared/filters/panel-intervals'
import { EVIDENCE_CONFIG } from '../../fixtures/shortlist/evidence-fixture'

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

/** A `streamVariantRows` stand-in yielding the given rows. */
function streamOf(rows: Variant[]): {
  streamVariantRows: ReturnType<typeof vi.fn>
  variantRowsQuery: ReturnType<typeof vi.fn>
} {
  return {
    streamVariantRows: vi.fn(async function* () {
      yield* rows as unknown as Array<Record<string, unknown>>
    }),
    // Only the evidence path (real PostgreSQL tests) pages through a cursor.
    variantRowsQuery: vi.fn()
  }
}

describe('PostgresShortlistService', () => {
  it('queries PostgreSQL variants with exact per-type scope and returns ranked rows', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [{ variant_id: 2, starred: 1 }] })
    }
    const rows = streamOf([
      variant({ id: 1, cadd: 10, clinvar: null }),
      variant({ id: 2, cadd: 40, clinvar: 'Pathogenic' })
    ])
    const service = new PostgresShortlistService({
      pool: pool as never,
      schema: 'public',
      filterPresets: { getPreset: vi.fn() },
      rows
    })

    const result = await service.getShortlist({ caseId: 1, adHocConfig: CONFIG })

    expect(rows.streamVariantRows).toHaveBeenCalledWith(
      expect.objectContaining({
        case_id: 1,
        variant_type: 'snv',
        exact_variant_type: true,
        consequences: ['HIGH'],
        gnomad_af_max: 0.01
      })
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

  it('never ClinVar-pins a disease-locus STR without a ClinVar annotation (#531)', async () => {
    const strRow = variant({
      id: 7,
      variant_type: 'str',
      consequence: null,
      clinvar: null,
      _str_status: 'pathologic',
      _str_disease: 'Huntington disease'
    } as Partial<Variant>)
    const service = new PostgresShortlistService({
      pool: { query: vi.fn().mockResolvedValue({ rows: [] }) } as never,
      schema: 'public',
      filterPresets: { getPreset: vi.fn() },
      rows: streamOf([strRow])
    })

    const result = await service.getShortlist({
      caseId: 1,
      adHocConfig: {
        ...CONFIG,
        variantTypeScope: ['str'],
        rankConfig: { ...CONFIG.rankConfig, clinvarPinTop: true }
      }
    })

    expect(result.rows[0]).toMatchObject({
      id: 7,
      str_disease: 'Huntington disease',
      rank_clinvar_pinned: false
    })
    expect(result.rows[0].rank_components.clinvar).toBe(0)
  })

  it('rethrows a refused panel filter as-is and aggregates other failures', async () => {
    const make = (error: Error): PostgresShortlistService =>
      new PostgresShortlistService({
        pool: { query: vi.fn() } as never,
        schema: 'public',
        filterPresets: { getPreset: vi.fn() },
        rows: {
          streamVariantRows: vi.fn(async function* () {
            yield* []
            throw error
          }),
          variantRowsQuery: vi.fn()
        }
      })

    const refused = new PanelRegionsUnavailableError(3, 'GRCh37')
    await expect(make(refused).getShortlist({ caseId: 1, adHocConfig: CONFIG })).rejects.toBe(
      refused
    )
    await expect(
      make(new Error('connection lost')).getShortlist({ caseId: 1, adHocConfig: CONFIG })
    ).rejects.toBeInstanceOf(ShortlistQueryError)
  })

  it('runs an evidence ranking in a read-only snapshot and rolls back on failure', async () => {
    const statements: string[] = []
    const client = {
      query: vi.fn(async (sql: string) => {
        statements.push(sql.split(' ').slice(0, 2).join(' '))
        if (sql.startsWith('FETCH')) throw new Error('cursor lost')
        return { rows: [] }
      }),
      release: vi.fn()
    }
    const service = new PostgresShortlistService({
      pool: { query: vi.fn(), connect: vi.fn().mockResolvedValue(client) } as never,
      schema: 'public',
      filterPresets: { getPreset: vi.fn() },
      rows: {
        streamVariantRows: vi.fn(),
        variantRowsQuery: vi.fn().mockResolvedValue({ sql: 'SELECT 1', params: [] })
      }
    })

    await expect(
      service.getShortlist({ caseId: 1, adHocConfig: EVIDENCE_CONFIG })
    ).rejects.toBeInstanceOf(ShortlistQueryError)
    expect(statements[0]).toBe('BEGIN ISOLATION')
    expect(client.query).toHaveBeenCalledWith('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    expect(statements.at(-1)).toBe('ROLLBACK')
    expect(statements).not.toContain('COMMIT')
    expect(client.release).toHaveBeenCalledTimes(1)
  })
})
