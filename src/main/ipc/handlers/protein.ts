import { z } from 'zod'
import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import { UniProtApiClient } from '../../services/api/UniProtApiClient'
import { InterProApiClient } from '../../services/api/InterProApiClient'
import { AlphaFoldApiClient } from '../../services/api/AlphaFoldApiClient'
import { EnsemblApiClient } from '../../services/api/EnsemblApiClient'
import { ApiCache } from '../../services/api/ApiCache'
import { networkStatus } from '../../services/network/NetworkStatus'
import { mainLogger } from '../../services/MainLogger'

/** Schema for gene symbol parameters */
const GeneSymbolSchema = z.string().min(1).max(50)

/** Schema for UniProt accession parameters */
const UniProtAccessionSchema = z.string().regex(/^[A-Z0-9]{6,10}$/i)

/**
 * Protein IPC handlers
 * Channels: protein:mapping, protein:domains, protein:structure, protein:gene-structure
 */

// Singleton instances - lazy initialization
let uniprotClient: UniProtApiClient | null = null
let interproClient: InterProApiClient | null = null
let alphafoldClient: AlphaFoldApiClient | null = null
let ensemblClient: EnsemblApiClient | null = null
let apiCache: ApiCache | null = null

export function registerProteinHandlers({ ipcMain, getDb }: HandlerDependencies): void {
  function getSharedCache(): ApiCache {
    if (!apiCache) {
      apiCache = new ApiCache(getDb().database)
    }
    return apiCache
  }

  function getUniProtClient(): UniProtApiClient {
    if (!uniprotClient) {
      uniprotClient = new UniProtApiClient(getSharedCache())
    }
    return uniprotClient
  }

  function getInterProClient(): InterProApiClient {
    if (!interproClient) {
      interproClient = new InterProApiClient(getSharedCache())
    }
    return interproClient
  }

  function getAlphaFoldClient(): AlphaFoldApiClient {
    if (!alphafoldClient) {
      alphafoldClient = new AlphaFoldApiClient(getSharedCache())
    }
    return alphafoldClient
  }

  function getEnsemblClient(): EnsemblApiClient {
    if (!ensemblClient) {
      ensemblClient = new EnsemblApiClient(getSharedCache())
    }
    return ensemblClient
  }

  /**
   * Fetch UniProt mapping for a gene symbol
   * Checks network status and returns cached data if offline
   */
  ipcMain.handle('protein:mapping', async (_event, geneSymbol: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = GeneSymbolSchema.safeParse(geneSymbol)
      if (!validated.success) {
        mainLogger.error(`Invalid protein:mapping params: ${validated.error.message}`, 'protein')
        throw new Error('Invalid parameters')
      }

      const client = getUniProtClient()
      const isOnline = networkStatus.getStatus()

      // If offline, delegate to the client which checks cache first.
      // If cached data is available it will return a proper ProteinMappingResult.
      // If no cache, the network request will fail and the client returns a ProteinApiError.
      if (!isOnline) {
        const result = await client.fetchProteinMapping(validated.data)
        // If the client returned a successful cached result, return it as-is
        if ('success' in result && result.success) {
          return result
        }
        // No cache available while offline - provide a clear offline error
        return {
          success: false,
          error: 'No network connection and no cached data available',
          offline: true
        }
      }

      // Online - fetch normally (will use cache if available)
      return await client.fetchProteinMapping(validated.data)
    })
  })

  /**
   * Fetch InterPro domains for a UniProt accession
   */
  ipcMain.handle('protein:domains', async (_event, uniprotAccession: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = UniProtAccessionSchema.safeParse(uniprotAccession)
      if (!validated.success) {
        mainLogger.error(`Invalid protein:domains params: ${validated.error.message}`, 'protein')
        throw new Error('Invalid parameters')
      }

      const client = getInterProClient()

      return await client.fetchDomains(validated.data)
    })
  })

  /**
   * Fetch AlphaFold structure info for a UniProt accession
   */
  ipcMain.handle('protein:structure', async (_event, uniprotAccession: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = UniProtAccessionSchema.safeParse(uniprotAccession)
      if (!validated.success) {
        mainLogger.error(`Invalid protein:structure params: ${validated.error.message}`, 'protein')
        throw new Error('Invalid parameters')
      }

      const client = getAlphaFoldClient()

      return await client.fetchStructure(validated.data)
    })
  })

  /**
   * Fetch gene structure (exon coordinates) from Ensembl for a gene symbol
   */
  ipcMain.handle('protein:gene-structure', async (_event, geneSymbol: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = GeneSymbolSchema.safeParse(geneSymbol)
      if (!validated.success) {
        mainLogger.error(
          `Invalid protein:gene-structure params: ${validated.error.message}`,
          'protein'
        )
        throw new Error('Invalid parameters')
      }

      const client = getEnsemblClient()

      return await client.fetchGeneStructure(validated.data)
    })
  })
}
