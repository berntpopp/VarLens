/**
 * Cohort carrier frequency (#555, audit 09 Part 2): carriers ÷ ready cases of
 * the same genome build that hold at least one call of the same variant
 * class. The case view and the cohort view report the same number, filters
 * use the same definition, and a no-call row is not a carrier.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DatabaseService } from '../../../src/main/database'
import { makeVariant as baseVariant } from '../../utils/make-variant'

const SNV = { chr: '1', pos: 100, ref: 'A', alt: 'G', variant_type: 'snv' }
const SV = { chr: '1', pos: 5000, ref: 'N', alt: '<DEL>', variant_type: 'sv', end_pos: 9000 }
const v = (over: Record<string, unknown>) =>
  baseVariant({ gene_symbol: null, consequence: null, ...over })

describe('cohort carrier frequency — case and cohort agree', () => {
  let service: DatabaseService
  let a38: number
  let b38: number
  let svOnly38: number
  let c37: number

  beforeEach(() => {
    service = new DatabaseService(':memory:')
    a38 = service.cases.createCase('a38', '/a.vcf', 1, 'GRCh38')
    b38 = service.cases.createCase('b38', '/b.vcf', 1, 'GRCh38')
    svOnly38 = service.cases.createCase('sv38', '/sv.vcf', 1, 'GRCh38')
    c37 = service.cases.createCase('c37', '/c.vcf', 1, 'GRCh37')
    service.variants.insertVariantsBatch(a38, [
      v({ ...SNV, gt_num: '0/1' }),
      v({ ...SV, gt_num: './.' }) // SV no-call: assayed, not a carrier
    ])
    service.variants.insertVariantsBatch(b38, [v({ ...SNV, gt_num: '1/1' })])
    service.variants.insertVariantsBatch(svOnly38, [v({ ...SV, gt_num: '0/1' })])
    // Same coordinate on the other build: a different locus.
    service.variants.insertVariantsBatch(c37, [v({ ...SNV, gt_num: '0/1' })])
    for (const id of [a38, b38, svOnly38, c37]) service.variants.updateFrequencies(id)
    service.cohortSummary.rebuild()
    service.cohort.invalidateColumnMetaCache()
  })

  afterEach(() => service.close())

  const caseRows = (caseId: number, filter: Record<string, unknown> = {}) =>
    service.variants.getVariants({ case_id: caseId, ...filter }, 50, 0).data
  const cohortRows = (params: Record<string, unknown> = {}) =>
    service.cohort.getCohortVariants({ limit: 50, offset: 0, ...params }).data
  const byType = <T extends { variant_type?: string | null }>(rows: T[], type: string) =>
    rows.find((row) => row.variant_type === type)

  it('divides by the cases of the same build and variant class', () => {
    // SNV: 2 GRCh38 carriers / 2 GRCh38 cases with small-variant data (sv38 has none).
    expect(byType(caseRows(a38), 'snv')?.internal_af).toBeCloseTo(1)
    // SV: 1 carrier (the no-call is not one) / 2 GRCh38 cases with SV data.
    expect(byType(caseRows(a38), 'sv')?.internal_af).toBeCloseTo(0.5)
    // GRCh37: its own numerator and denominator.
    expect(byType(caseRows(c37), 'snv')?.internal_af).toBeCloseTo(1)
  })

  it('reports the same number in the cohort view', () => {
    const g38 = cohortRows({ genome_build: 'GRCh38' })
    expect(byType(g38, 'snv')?.cohort_frequency).toBeCloseTo(1)
    expect(byType(g38, 'snv')?.carrier_count).toBe(2)
    expect(byType(g38, 'sv')?.cohort_frequency).toBeCloseTo(0.5)
    expect(byType(g38, 'sv')?.carrier_count).toBe(1)
    expect(byType(cohortRows({ genome_build: 'GRCh37' }), 'snv')?.cohort_frequency).toBeCloseTo(1)
  })

  it('filters by the same definition in both views', () => {
    expect(caseRows(a38, { max_internal_af: 0.6 }).map((r) => r.variant_type)).toEqual(['sv'])
    expect(caseRows(a38, { carrier_count_max: 1 }).map((r) => r.variant_type)).toEqual(['sv'])
    const g38 = { genome_build: 'GRCh38' }
    expect(cohortRows({ ...g38, max_internal_af: 0.6 }).map((r) => r.variant_type)).toEqual(['sv'])
    expect(cohortRows({ ...g38, carrier_count_max: 1 }).map((r) => r.variant_type)).toEqual(['sv'])
  })

  it('sorts by frequency within one build and class like by carriers', () => {
    const rows = cohortRows({ sort_by: 'cohort_frequency', sort_order: 'desc' })
    const freqs = rows.map((r) => r.cohort_frequency ?? -1)
    expect(freqs).toEqual([...freqs].sort((x, y) => y - x))
  })

  it('counts a JSON GTNum-Index code such as 0 as a carrier: only no-calls are not carriers', () => {
    // GTNum-Index (JSON import) stores an undocumented numeric code as text;
    // only the VCF no-call forms are known to mean "not carried".
    const json = service.cases.createCase('json38', '/j.json', 1, 'GRCh38')
    service.variants.insertVariantsBatch(json, [v({ ...SNV, gt_num: '0' })])
    service.cohortSummary.rebuild()
    service.cohort.invalidateColumnMetaCache()
    const snv = byType(cohortRows({ genome_build: 'GRCh38' }), 'snv')
    expect(snv?.carrier_count).toBe(3)
    expect(byType(caseRows(json), 'snv')?.internal_af).toBeCloseTo(1)
  })
})
