import { ipcMain } from 'electron'
import { wrapHandler } from '../errorHandler'
import { getDatabaseService } from '../../database'
import { CohortService } from '../../database/cohort'
import type { CohortSearchParams } from '../../../shared/types/cohort'

/**
 * Cohort IPC handlers
 * Channels: cohort:variants, cohort:summary
 */

ipcMain.handle('cohort:variants', async (_event, params: CohortSearchParams) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    const cohortService = new CohortService(db.database)
    const result = cohortService.getCohortVariants(params)
    // Deep clone to plain object for IPC serialization
    // better-sqlite3 can return objects with non-serializable properties
    const plainData = result.data.map((v) => ({
      chr: String(v.chr),
      pos: Number(v.pos),
      ref: String(v.ref),
      alt: String(v.alt),
      gene_symbol: v.gene_symbol ?? null,
      cdna: v.cdna ?? null,
      aa_change: v.aa_change ?? null,
      carrier_count: Number(v.carrier_count),
      total_cases: Number(v.total_cases),
      cohort_frequency: Number(v.cohort_frequency),
      het_count: Number(v.het_count),
      hom_count: Number(v.hom_count),
      variant_key: String(v.variant_key),
      consequence: v.consequence ?? null,
      func: v.func ?? null,
      clinvar: v.clinvar ?? null,
      gnomad_af: v.gnomad_af !== null ? Number(v.gnomad_af) : null,
      cadd_phred: v.cadd_phred !== null ? Number(v.cadd_phred) : null,
      transcript: v.transcript ?? null,
      omim_id: v.omim_id ?? null
    }))
    return {
      data: plainData,
      total_count: Number(result.total_count)
    }
  })
})

ipcMain.handle('cohort:summary', async (_event) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    const cohortService = new CohortService(db.database)
    const summary = cohortService.getCohortSummary()
    // Ensure data is serializable (convert any BigInt to Number)
    return JSON.parse(
      JSON.stringify(summary, (_key, value) => (typeof value === 'bigint' ? Number(value) : value))
    )
  })
})

ipcMain.handle(
  'cohort:carriers',
  async (_event, chr: string, pos: number, ref: string, alt: string) => {
    return wrapHandler(async () => {
      const db = getDatabaseService()
      const cohortService = new CohortService(db.database)
      const carriers = cohortService.getCarriers(chr, pos, ref, alt)
      // Ensure data is serializable (convert any BigInt to Number)
      return JSON.parse(
        JSON.stringify(carriers, (_key, value) =>
          typeof value === 'bigint' ? Number(value) : value
        )
      )
    })
  }
)

ipcMain.handle('cohort:geneBurden', async (_event) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    const cohortService = new CohortService(db.database)
    return cohortService.getGeneBurden()
  })
})
