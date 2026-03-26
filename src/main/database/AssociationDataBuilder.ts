import type Database from 'better-sqlite3-multiple-ciphers'
import type { GeneContingencyData, SampleBurdenData, VariantFilters } from '../statistics/types'
import { sqlPlaceholders } from './sql-utils'

export class AssociationDataBuilder {
  private db: Database.Database

  constructor(db: Database.Database) {
    this.db = db
  }

  build(
    groupA_ids: number[],
    groupB_ids: number[],
    filters: VariantFilters,
    covariateNames: string[]
  ): GeneContingencyData[] {
    const allIds = [...groupA_ids, ...groupB_ids]
    if (allIds.length === 0) return []

    const groupASet = new Set(groupA_ids)

    // Build WHERE clauses for variant filters
    const conditions: string[] = ['gene_symbol IS NOT NULL', "gene_symbol != ''"]
    const params: (string | number)[] = []

    // Case ID filter - use parameterized IN clause
    const placeholders = sqlPlaceholders(allIds.length)
    conditions.push(`case_id IN (${placeholders})`)
    params.push(...allIds)

    if (filters.gnomad_af_max !== undefined) {
      conditions.push('(gnomad_af IS NULL OR gnomad_af <= ?)')
      params.push(filters.gnomad_af_max)
    }
    if (filters.cadd_min !== undefined) {
      conditions.push('(cadd IS NULL OR cadd >= ?)')
      params.push(filters.cadd_min)
    }
    if (filters.consequences && filters.consequences.length > 0) {
      const cPlaceholders = sqlPlaceholders(filters.consequences.length)
      conditions.push(`consequence IN (${cPlaceholders})`)
      params.push(...filters.consequences)
    }
    if (filters.gene_list && filters.gene_list.length > 0) {
      const gPlaceholders = sqlPlaceholders(filters.gene_list.length)
      conditions.push(`gene_symbol IN (${gPlaceholders})`)
      params.push(...filters.gene_list)
    }

    const whereClause = conditions.join(' AND ')

    // Step 1: Get all qualifying variants grouped by gene and case
    const variantRows = this.db
      .prepare(
        `
      SELECT gene_symbol, case_id,
             chr || ':' || pos || ':' || ref || ':' || alt AS variant_key,
             CAST(COALESCE(gt_num, '0') AS INTEGER) AS dosage,
             gnomad_af, cadd
      FROM variants
      WHERE ${whereClause}
      ORDER BY gene_symbol, variant_key, case_id
    `
      )
      .all(...params) as Array<{
      gene_symbol: string
      case_id: number
      variant_key: string
      dosage: number
      gnomad_af: number | null
      cadd: number | null
    }>

    if (variantRows.length === 0) return []

    // Step 2: Load covariates if requested
    const covariateMap = new Map<number, number[]>()
    if (covariateNames.length > 0) {
      this.loadCovariates(allIds, covariateNames, covariateMap)
    }

    // Step 3: Group by gene -> variant_key -> case_id
    const geneMap = new Map<
      string,
      Map<string, Map<number, { dosage: number; gnomad_af: number | null; cadd: number | null }>>
    >()

    for (const row of variantRows) {
      if (!geneMap.has(row.gene_symbol)) {
        geneMap.set(row.gene_symbol, new Map())
      }
      const variantMap = geneMap.get(row.gene_symbol)!
      if (!variantMap.has(row.variant_key)) {
        variantMap.set(row.variant_key, new Map())
      }
      variantMap.get(row.variant_key)!.set(row.case_id, {
        dosage: row.dosage,
        gnomad_af: row.gnomad_af,
        cadd: row.cadd
      })
    }

    // Step 4: Build GeneContingencyData per gene
    const results: GeneContingencyData[] = []

    for (const [geneSymbol, variantMap] of geneMap) {
      const variantKeys = [...variantMap.keys()]

      // Compute carrier status per case
      let groupA_carriers = 0
      let groupA_nonCarriers = 0
      let groupB_carriers = 0
      let groupB_nonCarriers = 0

      const casesWithVariants = new Set<number>()
      for (const caseMap of variantMap.values()) {
        for (const [caseId, data] of caseMap) {
          if (data.dosage > 0) {
            casesWithVariants.add(caseId)
          }
        }
      }

      for (const caseId of groupA_ids) {
        if (casesWithVariants.has(caseId)) groupA_carriers++
        else groupA_nonCarriers++
      }
      for (const caseId of groupB_ids) {
        if (casesWithVariants.has(caseId)) groupB_carriers++
        else groupB_nonCarriers++
      }

      // Build per-sample burden data
      // Compute MAF from all samples
      const variantMafs: number[] = []
      const variantCadds: (number | null)[] = []

      for (const vKey of variantKeys) {
        const caseMap = variantMap.get(vKey)!
        let altCount = 0
        let totalAlleles = 0
        let caddSum = 0
        let caddCount = 0

        for (const caseId of allIds) {
          const data = caseMap.get(caseId)
          const dosage = data?.dosage ?? 0
          altCount += dosage
          totalAlleles += 2
          if (data?.cadd !== null && data?.cadd !== undefined) {
            caddSum += data.cadd
            caddCount++
          }
        }

        const maf = totalAlleles > 0 ? altCount / totalAlleles : 0
        variantMafs.push(Math.max(maf, 1e-8))
        variantCadds.push(caddCount > 0 ? caddSum / caddCount : null)
      }

      // Build sample data
      const samples: SampleBurdenData[] = []
      for (const caseId of allIds) {
        const dosages: number[] = []
        for (const vKey of variantKeys) {
          const data = variantMap.get(vKey)!.get(caseId)
          dosages.push(data?.dosage ?? 0)
        }

        samples.push({
          group: groupASet.has(caseId) ? 1 : 0,
          dosages,
          variant_mafs: variantMafs,
          variant_cadds: variantCadds,
          covariate_values: covariateMap.get(caseId) ?? []
        })
      }

      results.push({
        gene_symbol: geneSymbol,
        groupA_carrier_count: groupA_carriers,
        groupA_non_carrier_count: groupA_nonCarriers,
        groupB_carrier_count: groupB_carriers,
        groupB_non_carrier_count: groupB_nonCarriers,
        samples
      })
    }

    return results
  }

  private loadCovariates(
    caseIds: number[],
    covariateNames: string[],
    covariateMap: Map<number, number[]>
  ): void {
    // Load sex and age from case_metadata
    const placeholders = sqlPlaceholders(caseIds.length)
    const metaRows = this.db
      .prepare(`SELECT case_id, sex, age FROM case_metadata WHERE case_id IN (${placeholders})`)
      .all(...caseIds) as Array<{ case_id: number; sex: string | null; age: number | null }>

    const metaMap = new Map<number, { sex: string | null; age: number | null }>()
    for (const row of metaRows) {
      metaMap.set(row.case_id, { sex: row.sex, age: row.age })
    }

    // Load custom metrics
    const metricRows = this.db
      .prepare(
        `
      SELECT cm.case_id, md.name, cm.numeric_value
      FROM case_metrics cm
      JOIN metric_definitions md ON cm.metric_id = md.id
      WHERE cm.case_id IN (${placeholders})
        AND md.name IN (${sqlPlaceholders(covariateNames.length)})
    `
      )
      .all(...caseIds, ...covariateNames) as Array<{
      case_id: number
      name: string
      numeric_value: number | null
    }>

    const metricsMap = new Map<number, Map<string, number | null>>()
    for (const row of metricRows) {
      if (!metricsMap.has(row.case_id)) metricsMap.set(row.case_id, new Map())
      metricsMap.get(row.case_id)!.set(row.name, row.numeric_value)
    }

    // Build covariate vectors
    for (const caseId of caseIds) {
      const values: number[] = []
      for (const name of covariateNames) {
        if (name === 'sex') {
          const meta = metaMap.get(caseId)
          values.push(meta?.sex === 'male' ? 1 : meta?.sex === 'female' ? 0 : 0.5)
        } else if (name === 'age') {
          const meta = metaMap.get(caseId)
          values.push(meta?.age ?? 0)
        } else {
          const metricVal = metricsMap.get(caseId)?.get(name)
          values.push(metricVal ?? 0)
        }
      }
      covariateMap.set(caseId, values)
    }
  }
}
