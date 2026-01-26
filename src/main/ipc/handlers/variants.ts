import { ipcMain } from 'electron'
import { wrapHandler } from '../errorHandler'
import { getDatabaseService } from '../../database'
import type { VariantFilter, PaginationCursor, SortItem } from '../../database/types'
import type { FilterOptions } from '../../../shared/types/api'

/**
 * Variants IPC handlers
 * Channels: variants:query, variants:filterOptions
 */

ipcMain.handle(
  'variants:query',
  async (
    _event,
    caseId: number,
    filters: Omit<VariantFilter, 'case_id'>,
    cursor?: PaginationCursor,
    limit?: number,
    sortBy?: SortItem[]
  ) => {
    return wrapHandler(async () => {
      const db = getDatabaseService()
      const fullFilter: VariantFilter = { case_id: caseId, ...filters }
      return db.getVariants(fullFilter, limit ?? 50, cursor, sortBy)
    })
  }
)

ipcMain.handle('variants:filterOptions', async (_event, caseId: number) => {
  return wrapHandler(async () => {
    const db = getDatabaseService()

    // Get distinct consequences
    const consequencesResult = db.database
      .prepare(
        'SELECT DISTINCT consequence FROM variants WHERE case_id = ? AND consequence IS NOT NULL ORDER BY consequence'
      )
      .all(caseId) as { consequence: string }[]

    // Get CADD range
    const caddRange = db.database
      .prepare(
        'SELECT MIN(cadd) as min_cadd, MAX(cadd) as max_cadd FROM variants WHERE case_id = ? AND cadd IS NOT NULL'
      )
      .get(caseId) as { min_cadd: number | null; max_cadd: number | null } | undefined

    // Get gnomAD AF range
    const afRange = db.database
      .prepare(
        'SELECT MIN(gnomad_af) as min_af, MAX(gnomad_af) as max_af FROM variants WHERE case_id = ? AND gnomad_af IS NOT NULL'
      )
      .get(caseId) as { min_af: number | null; max_af: number | null } | undefined

    const filterOptions: FilterOptions = {
      consequences: consequencesResult.map((r) => r.consequence),
      minCadd: caddRange?.min_cadd ?? null,
      maxCadd: caddRange?.max_cadd ?? null,
      minGnomadAf: afRange?.min_af ?? null,
      maxGnomadAf: afRange?.max_af ?? null
    }

    return filterOptions
  })
})
