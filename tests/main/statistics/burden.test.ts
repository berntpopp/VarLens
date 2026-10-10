import { describe, it, expect } from 'vitest'
import { logisticBurdenTest } from '../../../src/main/statistics/burden'
import type { AssociationConfig, SampleBurdenData } from '../../../src/main/statistics/types'
import {
  buildCovariateMap,
  buildGeneContingencyData,
  type AssociationVariantRow,
  type CaseMetaRow
} from '../../../src/main/statistics/contingency'
import { computeGeneAssociation } from '../../../src/main/statistics/gene-tests'
import { finalizeAssociationResults } from '../../../src/main/statistics/finalize'

function makeSample(group: 0 | 1, dosages: number[], mafs: number[]): SampleBurdenData {
  return {
    group,
    dosages,
    variant_mafs: mafs,
    variant_cadds: dosages.map(() => null),
    covariate_values: []
  }
}

describe('logisticBurdenTest', () => {
  it('returns NO_SAMPLES warning for empty input', () => {
    const result = logisticBurdenTest([], 'uniform')
    expect(result.warning).toBe('NO_SAMPLES')
    expect(result.p_value).toBeNull()
  })

  it('returns ZERO_BURDEN when no variants qualify', () => {
    const samples: SampleBurdenData[] = [
      makeSample(1, [0, 0], [0.01, 0.02]),
      makeSample(0, [0, 0], [0.01, 0.02])
    ]
    const result = logisticBurdenTest(samples, 'uniform')
    expect(result.warning).toBe('ZERO_BURDEN')
  })

  it('runs standard logistic regression for well-behaved data', () => {
    const samples: SampleBurdenData[] = []
    // Group A: higher burden
    for (let i = 0; i < 20; i++) {
      samples.push(makeSample(1, [i % 3 === 0 ? 1 : 0, i % 2 === 0 ? 1 : 0], [0.01, 0.02]))
    }
    // Group B: lower burden
    for (let i = 0; i < 20; i++) {
      samples.push(makeSample(0, [i % 5 === 0 ? 1 : 0, 0], [0.01, 0.02]))
    }
    const result = logisticBurdenTest(samples, 'uniform')
    expect(result.used_firth).toBe(false)
    expect(result.p_value).toBeDefined()
    expect(result.beta).toBeDefined()
  })

  it('falls back to Firth for perfect separation', () => {
    const samples: SampleBurdenData[] = [
      makeSample(1, [2], [0.01]),
      makeSample(1, [1], [0.01]),
      makeSample(1, [3], [0.01]),
      makeSample(0, [0], [0.01]),
      makeSample(0, [0], [0.01]),
      makeSample(0, [0], [0.01]),
      makeSample(0, [0], [0.01]),
      makeSample(0, [0], [0.01])
    ]
    const result = logisticBurdenTest(samples, 'uniform')
    expect(result.used_firth).toBe(true)
    expect(result.p_value).toBeDefined()
    expect(result.p_value).not.toBeNull()
  })
})

describe('missing covariates (#499)', () => {
  const config: AssociationConfig = {
    groupA_ids: [],
    groupB_ids: [],
    primary_test: 'logistic_burden',
    weight_scheme: 'uniform',
    covariates: ['age', 'bmi'],
    filters: {},
    max_threads: 1
  }

  // 20 cases (ids 1-20) vs 20 controls (ids 21-40), ages 30-69 in both groups, carriers enriched in cases.
  const ids = Array.from({ length: 40 }, (_, i) => i + 1)
  const meta = ids.map((id) => ({ case_id: id, sex: null, age: 30 + ((id * 7) % 40) }))
  const metrics = ids.map((id) => ({ case_id: id, name: 'bmi', numeric_value: 20 + (id % 7) }))
  const rowsFor = (caseIds: number[]): AssociationVariantRow[] =>
    caseIds
      .filter((id) => (id <= 20 ? id % 2 === 0 : id % 5 === 0))
      .map((id) => ({
        gene_symbol: 'GENE1',
        case_id: id,
        variant_key: '1:100:A:T',
        gt_num: '0/1',
        dosage: 1,
        gnomad_af: null,
        cadd: null
      }))

  function run(groupA: number[], groupB: number[], metaRows: CaseMetaRow[], metricRows = metrics) {
    const all = [...groupA, ...groupB]
    const covariates = buildCovariateMap(all, config.covariates, metaRows, metricRows)
    const genes = buildGeneContingencyData(rowsFor(all), groupA, groupB, covariates)
    return finalizeAssociationResults(
      genes.map((gene) => computeGeneAssociation(gene, 'uniform')),
      config,
      Date.now()
    )
  }

  const groupA = ids.slice(0, 20)
  const groupB = ids.slice(20)
  const complete = run(groupA, groupB, meta)

  it('reports nothing when every sample has its covariates', () => {
    expect(complete.results[0].logistic_burden.beta).not.toBeNull()
    expect(complete.warnings).toEqual([])
  })

  it('excludes a sample without an age instead of analysing it as age 0', () => {
    // Case 41: a carrier in group A whose age was never recorded.
    const withMissing = run(
      [...groupA, 41],
      groupB,
      [...meta, { case_id: 41, sex: null, age: null }],
      [...metrics, { case_id: 41, name: 'bmi', numeric_value: 22 }]
    )

    expect(withMissing.results[0].logistic_burden.beta).toBe(
      complete.results[0].logistic_burden.beta
    )
    expect(withMissing.results[0].logistic_burden.p_value).toBe(
      complete.results[0].logistic_burden.p_value
    )
    // Fisher's test needs no covariates and still counts the sample.
    expect(withMissing.results[0].groupA_total).toBe(21)
    expect(withMissing.warnings).toEqual([expect.stringMatching(/^MISSING_COVARIATE: 1 sample/)])
  })

  it('excludes a sample without a selected metric value', () => {
    const withMissing = run([...groupA, 41], groupB, [...meta, { case_id: 41, sex: null, age: 50 }])

    expect(withMissing.results[0].logistic_burden.beta).toBe(
      complete.results[0].logistic_burden.beta
    )
    expect(withMissing.warnings).toEqual([expect.stringMatching(/^MISSING_COVARIATE: 1 sample/)])
  })

  it('frequencies and weights describe the tested samples (#520)', () => {
    // Case 41: a homozygous carrier in group A whose age and metric were never recorded.
    const carrier41: AssociationVariantRow = {
      gene_symbol: 'GENE1',
      case_id: 41,
      variant_key: '1:100:A:T',
      gt_num: '1/1',
      dosage: 2,
      gnomad_af: null,
      cadd: null
    }
    const gene = (a: number[], metaRows: CaseMetaRow[], extra: AssociationVariantRow[] = []) => {
      const all = [...a, ...groupB]
      const covariates = buildCovariateMap(all, config.covariates, metaRows, metrics)
      return buildGeneContingencyData([...rowsFor(all), ...extra], a, groupB, covariates)[0]
    }

    const reference = gene(groupA, meta)
    const withMissing = gene(
      [...groupA, 41],
      [...meta, { case_id: 41, sex: null, age: null }],
      [carrier41]
    )

    expect(withMissing.samples[0].variant_mafs).toEqual(reference.samples[0].variant_mafs)
    expect(logisticBurdenTest(withMissing.samples, 'beta_maf').beta).toBe(
      logisticBurdenTest(reference.samples, 'beta_maf').beta
    )
    // Fisher's test needs no covariates and still counts the sample.
    expect(withMissing.groupA_carrier_count).toBe(reference.groupA_carrier_count + 1)
  })

  it('CADD weights exclude samples missing a selected covariate', () => {
    const rows = rowsFor(ids).map((row) => ({ ...row, cadd: 20 }))
    const covariates = buildCovariateMap([...ids, 41], config.covariates, meta, metrics)
    const reference = buildGeneContingencyData(rows, groupA, groupB, covariates)[0]
    const withMissing = buildGeneContingencyData(
      [...rows, { ...rows[0], case_id: 41, cadd: 40 }],
      [...groupA, 41],
      groupB,
      covariates
    )[0]

    expect(withMissing.samples[0].variant_cadds).toEqual([20])
    expect(logisticBurdenTest(withMissing.samples, 'beta_maf_cadd').beta).toBe(
      logisticBurdenTest(reference.samples, 'beta_maf_cadd').beta
    )
  })
})
