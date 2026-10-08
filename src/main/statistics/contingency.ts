/**
 * Backend-neutral half of association data building: turns the stored rows of
 * the selected cases at the qualifying sites into per-gene contingency data.
 * Shared by the SQLite AssociationDataBuilder (desktop) and the Postgres
 * builder (web), so both runtimes compute identical inputs.
 * Rules: .planning/specs/2026-10-08-burden-test-eligible-sites.md (phase 1).
 */
import { calledAlleleCount, genotypeCallKey } from '../../shared/utils/genotype'
import type {
  GeneContingencyData,
  SampleBurdenData,
  SiteExclusionCounts,
  SiteExclusionReason
} from './types'
import { InvalidParametersError } from '../ipc/errors'

export interface AssociationVariantRow {
  gene_symbol: string
  case_id: number
  variant_key: string
  /** The stored genotype `dosage` was read from. */
  gt_num: string | null
  /** gtDosageSql of `gt_num`: 2, 1, 0, or null for a call outside the carrier and reference classes. */
  dosage: number | null
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

type VariantCaseData = {
  gt_num: string | null
  dosage: number | null
  /** Rows of this case disagree in dosage: the call is missing. */
  conflict: boolean
  cadd: number | null
}
type CaseCalls = Map<number, VariantCaseData>
type GeneVariantMap = Map<string, Map<string, CaseCalls>>
/** A site the gene's tests use, with its ALT allele frequency among the tested samples. */
type Site = { calls: CaseCalls; frequency: number }

/** A sample enters the regression only when every selected covariate is present. */
export const hasCompleteCovariates = (values: readonly (number | null)[]): boolean =>
  values.every(Number.isFinite)

/**
 * Covariate vector per case: sex (1 male / 0 female / 0.5 unknown), age, custom metrics.
 * A missing age or metric is NaN, never 0: `logisticBurdenTest` drops such samples.
 */
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
        values.push(meta?.age ?? NaN)
      } else {
        values.push(metricsMap.get(caseId)?.get(name) ?? NaN)
      }
    }
    covariateMap.set(caseId, values)
  }
  return covariateMap
}

/**
 * A run compares sites by chr:pos:ref:alt, which names one site only within
 * one genome build. `builds` are the distinct builds of the selected cases.
 */
export function assertSingleGenomeBuild(builds: (string | null)[]): void {
  const distinct = [...new Set(builds.map((build) => build ?? 'unknown'))].sort()
  if (distinct.length <= 1) return
  const message =
    `Mixed genome builds: the selected cases use ${distinct.join(' and ')}. ` +
    'Run the burden test on cases of one genome build.'
  throw new InvalidParametersError(message, message)
}

/**
 * The dosage of one stored row; null = missing. SQL gives NULL for every call
 * outside the carrier and reference classes. Of those, a reference half-call
 * (`0/.`) is two called alleles with no copy of this ALT, so it is 0. What is
 * left — `./.`, NULL, other text — is the unknown class.
 */
function rowDosage(row: AssociationVariantRow): number | null {
  return row.dosage ?? (calledAlleleCount(row.gt_num) > 0 ? 0 : null)
}

function groupRows(rows: AssociationVariantRow[]): GeneVariantMap {
  const geneMap: GeneVariantMap = new Map()
  for (const row of rows) {
    const dosage = rowDosage(row)
    if (!geneMap.has(row.gene_symbol)) geneMap.set(row.gene_symbol, new Map())
    const variantMap = geneMap.get(row.gene_symbol)!
    if (!variantMap.has(row.variant_key)) variantMap.set(row.variant_key, new Map())
    const calls = variantMap.get(row.variant_key)!
    const kept = calls.get(row.case_id)
    if (!kept) {
      calls.set(row.case_id, { gt_num: row.gt_num, dosage, conflict: false, cadd: row.cadd })
      continue
    }
    // Duplicate rows of one case: equal dosages agree (0/1 and 0|1). No row wins otherwise.
    // Association test only; the cohort summary keeps "highest dosage" (genotypeCallKey).
    if (kept.dosage !== dosage) kept.conflict = true
    // The greatest call key names the ploidy of an agreed call (frequency denominator).
    if (genotypeCallKey(row.gt_num) > genotypeCallKey(kept.gt_num)) kept.gt_num = row.gt_num
    kept.cadd ??= row.cadd
  }
  return geneMap
}

/**
 * Why a site cannot be used, judged on every selected sample so both groups
 * and both tests share one site set. A conflict outranks a missing call, so
 * the reason does not depend on the sample order.
 */
function siteExclusion(calls: CaseCalls, allIds: number[]): SiteExclusionReason | null {
  let missing = false
  for (const caseId of allIds) {
    const data = calls.get(caseId)
    if (!data) continue // no row: read as reference
    if (data.conflict) return 'conflicting_calls'
    if (data.dosage === null) missing = true
  }
  return missing ? 'missing_call' : null
}

/** ALT allele frequency among `ids`; null when they call no allele at all. */
function altAlleleFrequency(calls: CaseCalls, ids: number[]): number | null {
  let altCount = 0
  let calledAlleles = 0
  for (const caseId of ids) {
    const data = calls.get(caseId)
    altCount += data?.dosage ?? 0
    // No row: reference sites are not stored, so the sample is read as a diploid 0/0.
    calledAlleles += data ? calledAlleleCount(data.gt_num) : 2
  }
  return calledAlleles > 0 ? altCount / calledAlleles : null
}

function eligibleSites(
  variantMap: Map<string, CaseCalls>,
  allIds: number[],
  frequencyIds: number[]
): { sites: Site[]; sites_excluded: SiteExclusionCounts } {
  const sites: Site[] = []
  const sites_excluded: SiteExclusionCounts = {
    missing_call: 0,
    conflicting_calls: 0,
    no_called_alleles: 0
  }
  for (const calls of variantMap.values()) {
    const reason = siteExclusion(calls, allIds)
    const frequency = reason === null ? altAlleleFrequency(calls, frequencyIds) : null
    if (frequency === null) sites_excluded[reason ?? 'no_called_alleles']++
    else sites.push({ calls, frequency })
  }
  return { sites, sites_excluded }
}

function carrierCounts(
  sites: Site[],
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
  for (const { calls } of sites) {
    for (const [caseId, data] of calls) if ((data.dosage ?? 0) > 0) carriers.add(caseId)
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

function meanCadd(calls: CaseCalls, allIds: number[]): number | null {
  let sum = 0
  let count = 0
  for (const caseId of allIds) {
    const cadd = calls.get(caseId)?.cadd
    if (cadd !== null && cadd !== undefined) {
      sum += cadd
      count++
    }
  }
  return count > 0 ? sum / count : null
}

function geneSamples(
  sites: Site[],
  allIds: number[],
  groupASet: Set<number>,
  covariateMap: Map<number, number[]>
): SampleBurdenData[] {
  // ALT allele frequency p; computeWeight takes the weight at min(p, 1 - p).
  const variantMafs = sites.map((site) => Math.max(site.frequency, 1e-8))
  const variantCadds = sites.map((site) => meanCadd(site.calls, allIds))
  return allIds.map((caseId) => ({
    group: groupASet.has(caseId) ? 1 : 0,
    dosages: sites.map((site) => site.calls.get(caseId)?.dosage ?? 0),
    variant_mafs: variantMafs,
    variant_cadds: variantCadds,
    covariate_values: covariateMap.get(caseId) ?? []
  }))
}

/**
 * Group the stored rows by gene → site → case and build the per-gene carrier
 * table plus per-sample burden inputs. A site with a missing dosage in any
 * selected sample is used for no sample; nothing is imputed.
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
    // Frequencies and weights describe the samples the regression tests (burden.ts).
    const testedIds = allIds.filter((id) => hasCompleteCovariates(covariateMap.get(id) ?? []))
    const { sites, sites_excluded } = eligibleSites(variantMap, allIds, testedIds)
    results.push({
      gene_symbol: geneSymbol,
      ...carrierCounts(sites, groupA_ids, groupB_ids),
      sites_excluded,
      samples: geneSamples(sites, allIds, groupASet, covariateMap)
    })
  }
  return results
}
