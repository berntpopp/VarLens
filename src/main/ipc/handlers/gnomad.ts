import { z } from 'zod'
import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import { GnomadApiClient } from '../../services/api/GnomadApiClient'
import { ApiCache } from '../../services/api/ApiCache'
import { networkStatus } from '../../services/network/NetworkStatus'
import { mainLogger } from '../../services/MainLogger'

/** Schema for gene symbol parameters */
const GeneSymbolSchema = z.string().min(1).max(50)

/** Schema for optional dataset parameter */
const DatasetSchema = z.enum(['gnomad_r4', 'gnomad_r3', 'gnomad_r2_1']).optional()

/**
 * gnomAD IPC handlers
 * Channels: gnomad:variants, gnomad:clinvar
 */

// Singleton instances - lazy initialization
let gnomadClient: GnomadApiClient | null = null
let apiCache: ApiCache | null = null

export function registerGnomadHandlers({ ipcMain, getDb }: HandlerDependencies): void {
  function getGnomadClient(): GnomadApiClient {
    if (!gnomadClient) {
      const db = getDb().database
      apiCache = new ApiCache(db)
      gnomadClient = new GnomadApiClient(apiCache)
    }
    return gnomadClient
  }

  /**
   * Fetch gnomAD population variant frequencies for a gene
   * gnomAD always requires network — no offline fallback
   */
  ipcMain.handle('gnomad:variants', async (_event, geneSymbol: unknown, dataset?: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const geneValidated = GeneSymbolSchema.safeParse(geneSymbol)
      if (!geneValidated.success) {
        mainLogger.error(
          `Invalid gnomad:variants params (geneSymbol): ${geneValidated.error.message}`,
          'gnomad'
        )
        throw new Error('Invalid parameters')
      }

      const datasetValidated = DatasetSchema.safeParse(dataset)
      if (!datasetValidated.success) {
        mainLogger.error(
          `Invalid gnomad:variants params (dataset): ${datasetValidated.error.message}`,
          'gnomad'
        )
        throw new Error('Invalid parameters')
      }

      const client = getGnomadClient()

      // Try fetching (client checks cache first, then network)
      // If offline and cached data exists, the client will return cached results
      if (!networkStatus.getStatus()) {
        // Still try the client — it may have cached data
        const cached = await client.fetchGeneVariants(geneValidated.data, datasetValidated.data)
        if (cached.success) return cached
        return {
          success: false,
          error: 'No network connection and no cached gnomAD data available',
          offline: true
        }
      }

      return await client.fetchGeneVariants(geneValidated.data, datasetValidated.data)
    })
  })

  /**
   * Fetch ClinVar variants for a gene via gnomAD GraphQL API
   */
  ipcMain.handle('gnomad:clinvar', async (_event, geneSymbol: unknown, dataset?: unknown) => {
    return wrapHandler(async () => {
      const geneValidated = GeneSymbolSchema.safeParse(geneSymbol)
      if (!geneValidated.success) {
        mainLogger.error(
          `Invalid gnomad:clinvar params (geneSymbol): ${geneValidated.error.message}`,
          'gnomad'
        )
        throw new Error('Invalid parameters')
      }

      const datasetValidated = DatasetSchema.safeParse(dataset)
      if (!datasetValidated.success) {
        mainLogger.error(
          `Invalid gnomad:clinvar params (dataset): ${datasetValidated.error.message}`,
          'gnomad'
        )
        throw new Error('Invalid parameters')
      }

      const client = getGnomadClient()

      if (!networkStatus.getStatus()) {
        const cached = await client.fetchClinVarVariants(geneValidated.data, datasetValidated.data)
        if (cached.success) return cached
        return {
          success: false,
          error: 'No network connection and no cached ClinVar data available',
          offline: true
        }
      }

      return await client.fetchClinVarVariants(geneValidated.data, datasetValidated.data)
    })
  })
}
