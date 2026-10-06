/**
 * Backend-neutral half of association data building: turns qualifying
 * variant rows (already filtered in SQL) and covariate inputs into per-gene
 * contingency data. Shared by the SQLite AssociationDataBuilder (desktop) and
 * the Postgres builder (web), so both runtimes compute identical inputs.
 */
import type { GeneContingencyData, SampleBurdenData } from './types'

export interface AssociationVariantRow {
  gene_symbol: string
  case_id: number
  variant_key: string
  dosage: number
  gnomad_af: number | null
  cadd: number | null
}

export interface CaseMetaRow {
  case_id: number
  sex: string | null
  age: number | null
}

export interface CaseMetricRow {
  case_id: number
  name: string
  numeric_value: number | null
}

type VariantCaseData = { dosage: number; gnomad_af: number | null; cadd: number | null }
type GeneVariantMap = Map<string, Map<string, Map<number, VariantCaseData>>>

/** Covariate vector per case: sex (1 male / 0 female / 0.5 unknown), age, custom metrics. */
export function buildCovariateMap(
  caseIds: number[],
  covariateNames: string[],
  metaRows: CaseMetaRow[],
  metricRows: CaseMetricRow[]
): Map<number, number[]> {
  const metaMap = new Map<number, { sex: string | null; age: number | null }>()
  for (const row of metaRows) metaMap.set(row.case_id, { sex: row.sex, age: row.age })

  const metricsMap = new Map<number, Map<string, number | null>>()
  for (const row of metricRows) {
    if (!metricsMap.has(row.case_id)) metricsMap.set(row.case_id, new Map())
    metricsMap.get(row.case_id)!.set(row.name, row.numeric_value)
  }

  const covariateMap = new Map<number, number[]>()
  for (const caseId of caseIds) {
    const values: number[] = []
    for (const name of covariateNames) {
      const meta = metaMap.get(caseId)
      if (name === 'sex') {
        values.push(meta?.sex === 'male' ? 1 : meta?.sex === 'female' ? 0 : 0.5)
      } else if (name === 'age') {
        values.push(meta?.age ?? 0)
      } else {
        values.push(metricsMap.get(caseId)?.get(name) ?? 0)
      }
    }
    covariateMap.set(caseId, values)
  }
  return covariateMap
}

function groupRows(rows: AssociationVariantRow[]): GeneVariantMap {
  const geneMap: GeneVariantMap = new Map()
  for (const row of rows) {
    if (!geneMap.has(row.gene_symbol)) geneMap.set(row.gene_symbol, new Map())
    const variantMap = geneMap.get(row.gene_symbol)!
    if (!variantMap.has(row.variant_key)) variantMap.set(row.variant_key, new Map())
    variantMap.get(row.variant_key)!.set(row.case_id, {
      dosage: row.dosage,
      gnomad_af: row.gnomad_af,
      cadd: row.cadd
    })
  }
  return geneMap
}

function carrierCounts(
  variantMap: Map<string, Map<number, VariantCaseData>>,
  groupA_ids: number[],
  groupB_ids: number[]
): Pick<
  GeneContingencyData,
  | 'groupA_carrier_count'
  | 'groupA_non_carrier_count'
  | 'groupB_carrier_count'
  | 'groupB_non_carrier_count'
> {
  const carriers = new Set<number>()
  for (const caseMap of variantMap.values()) {
    for (const [caseId, data] of caseMap) if (data.dosage > 0) carriers.add(caseId)
  }
  const a = groupA_ids.filter((id) => carriers.has(id)).length
  const b = groupB_ids.filter((id) => carriers.has(id)).length
  return {
    groupA_carrier_count: a,
    groupA_non_carrier_count: groupA_ids.length - a,
    groupB_carrier_count: b,
    groupB_non_carrier_count: groupB_ids.length - b
  }
}

function geneSamples(
  variantMap: Map<string, Map<number, VariantCaseData>>,
  allIds: number[],
  groupASet: Set<number>,
  covariateMap: Map<number, number[]>
): SampleBurdenData[] {
  const variantKeys = [...variantMap.keys()]
  const variantMafs: number[] = []
  const variantCadds: (number | null)[] = []

  for (const vKey of variantKeys) {
    const caseMap = variantMap.get(vKey)!
    let altCount = 0
    let caddSum = 0
    let caddCount = 0
    for (const caseId of allIds) {
      const data = caseMap.get(caseId)
      altCount += data?.dosage ?? 0
      if (data?.cadd !== null && data?.cadd !== undefined) {
        caddSum += data.cadd
        caddCount++
      }
    }
    const totalAlleles = allIds.length * 2
    const maf = totalAlleles > 0 ? altCount / totalAlleles : 0
    variantMafs.push(Math.max(maf, 1e-8))
    variantCadds.push(caddCount > 0 ? caddSum / caddCount : null)
  }

  return allIds.map((caseId) => ({
    group: groupASet.has(caseId) ? 1 : 0,
    dosages: variantKeys.map((vKey) => variantMap.get(vKey)!.get(caseId)?.dosage ?? 0),
    variant_mafs: variantMafs,
    variant_cadds: variantCadds,
    covariate_values: covariateMap.get(caseId) ?? []
  }))
}

/**
 * Group qualifying variant rows by gene → variant → case and build the
 * per-gene carrier table plus per-sample burden inputs.
 */
export function buildGeneContingencyData(
  rows: AssociationVariantRow[],
  groupA_ids: number[],
  groupB_ids: number[],
  covariateMap: Map<number, number[]>
): GeneContingencyData[] {
  const allIds = [...groupA_ids, ...groupB_ids]
  const groupASet = new Set(groupA_ids)
  const results: GeneContingencyData[] = []
  for (const [geneSymbol, variantMap] of groupRows(rows)) {
    results.push({
      gene_symbol: geneSymbol,
      ...carrierCounts(variantMap, groupA_ids, groupB_ids),
      samples: geneSamples(variantMap, allIds, groupASet, covariateMap)
    })
  }
  return results
}
