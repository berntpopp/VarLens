import { describe, expect, it, vi } from 'vitest'
import { mockApi } from '../../../src/renderer/src/mocks/mockApi'
import { unwrapIpcResult } from '../../../src/shared/types/errors'

vi.mock('../../../src/renderer/src/mocks/fixtures/cases', () => ({
  mockCases: [
    { id: 1, name: 'Case 38', genome_build: 'GRCh38' },
    { id: 2, name: 'Case 37', genome_build: 'GRCh37' }
  ]
}))

vi.mock('../../../src/renderer/src/mocks/fixtures/variants', () => ({
  mockFilterOptions: {},
  mockVariants: [
    {
      id: 1,
      case_id: 1,
      chr: '1',
      pos: 100,
      ref: 'N',
      alt: '<DEL>',
      variant_type: 'sv',
      gt_num: '0/1'
    },
    {
      id: 2,
      case_id: 1,
      chr: '1',
      pos: 100,
      ref: 'N',
      alt: '<DEL>',
      variant_type: 'sv',
      gt_num: '1/1'
    },
    {
      id: 3,
      case_id: 2,
      chr: '1',
      pos: 100,
      ref: 'N',
      alt: '<DEL>',
      variant_type: 'sv',
      gt_num: '0/1'
    },
    {
      id: 4,
      case_id: 1,
      chr: '1',
      pos: 100,
      ref: 'N',
      alt: '<DEL>',
      variant_type: 'cnv',
      gt_num: '0/1'
    },
    {
      id: 5,
      case_id: 1,
      chr: '2',
      pos: 200,
      ref: 'AT',
      alt: 'A',
      variant_type: 'indel',
      gt_num: '0/1'
    }
  ]
}))

describe('mock cohort identity parity', () => {
  it('offers every genome build actually present in the cases', async () => {
    expect(unwrapIpcResult(await mockApi.cases.availableBuilds())).toEqual([
      { build: 'GRCh38', caseCount: 1 },
      { build: 'GRCh37', caseCount: 1 }
    ])
  })

  it('scopes rows and their frequency to the selected build and type', async () => {
    const result = unwrapIpcResult(
      await mockApi.cohort.getVariants({ genome_build: 'GRCh37', variant_type: 'sv' })
    )
    expect(result.total_count).toBe(1)
    expect(result.data).toMatchObject([
      { genome_build: 'GRCh37', variant_type: 'sv', total_cases: 1, cohort_frequency: 1 }
    ])
  })

  it('includes stored indels under the SNV/Indel selector', async () => {
    const result = unwrapIpcResult(await mockApi.cohort.getVariants({ variant_type: 'snv' }))
    expect(result.data.map((row) => row.variant_type)).toEqual(['indel'])
  })

  it('returns one resolved call per carrier, matching the summary counts', async () => {
    const result = unwrapIpcResult(await mockApi.cohort.getVariants({}))
    const row = result.data.find(
      (item) => item.genome_build === 'GRCh38' && item.variant_type === 'sv'
    )!
    const carriers = unwrapIpcResult(await mockApi.cohort.getCarriers(row))
    expect(carriers).toEqual([{ case_id: 1, case_name: 'Case 38', gt_num: '1/1' }])
    expect(row).toMatchObject({ carrier_count: 1, hom_count: 1, het_count: 0, cohort_frequency: 1 })
  })
})
