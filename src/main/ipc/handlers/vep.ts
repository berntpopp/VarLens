import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import { VepApiClient, normalizeChromosome } from '../../services/api/VepApiClient'
import { ApiCache } from '../../services/api/ApiCache'
import { networkStatus } from '../../services/network/NetworkStatus'
import { VariantCoordsSchema } from '../../../shared/types/ipc-schemas'
import { mainLogger } from '../../services/MainLogger'

/**
 * VEP IPC handlers
 * Channels: vep:fetch, vep:cancel, vep:clearCache, vep:getCacheStats
 */

// Singleton instances - lazy initialization
let vepClient: VepApiClient | null = null
let apiCache: ApiCache | null = null

export function registerVepHandlers({ ipcMain, getDb }: HandlerDependencies): void {
  function getVepClient(): VepApiClient {
    if (!vepClient) {
      const db = getDb().database
      apiCache = new ApiCache(db)
      vepClient = new VepApiClient(apiCache)
    }
    return vepClient
  }

  /**
   * Fetch VEP annotation for a variant
   * Checks network status and returns cached data if offline
   */
  ipcMain.handle(
    'vep:fetch',
    async (_event, chr: unknown, pos: unknown, ref: unknown, alt: unknown) => {
      return wrapHandler(async () => {
        // ANTI-07: Runtime validation at IPC boundary
        const validated = VariantCoordsSchema.safeParse({ chr, pos, ref, alt })
        if (!validated.success) {
          mainLogger.error(`Invalid vep:fetch params: ${validated.error.message}`, 'vep')
          throw new Error('Invalid parameters')
        }

        const client = getVepClient()
        const isOnline = networkStatus.getStatus()

        // If offline, try to get cached data
        if (!isOnline) {
          const normalizedChr = normalizeChromosome(validated.data.chr)
          const cacheKey = `vep:${normalizedChr}:${validated.data.pos}:${validated.data.ref}:${validated.data.alt}`
          const cached = client.getCached(cacheKey)

          if (cached) {
            return {
              success: true,
              data: cached.data,
              cacheInfo: {
                cached: true,
                cachedAt: cached.createdAt
              }
            }
          }

          // No cache available while offline
          return {
            success: false,
            error: 'No network connection and no cached data available',
            offline: true
          }
        }

        // Online - fetch normally (will use cache if available)
        return await client.fetchVariantAnnotation(
          validated.data.chr,
          validated.data.pos,
          validated.data.ref,
          validated.data.alt
        )
      })
    }
  )

  /**
   * Cancel pending VEP request
   * Called when user selects a new variant before previous request completes
   */
  ipcMain.handle('vep:cancel', async () => {
    return wrapHandler(async () => {
      if (vepClient) {
        vepClient.cancelPendingRequest()
      }
      return undefined
    })
  })

  /**
   * Clear VEP cache
   * Called from settings page
   */
  ipcMain.handle('vep:clearCache', async () => {
    return wrapHandler(async () => {
      if (vepClient) {
        vepClient.clearCache()
      }
      return { success: true }
    })
  })

  /**
   * Get VEP cache statistics
   * Returns count of cached entries and total size
   */
  ipcMain.handle('vep:getCacheStats', async () => {
    return wrapHandler(async () => {
      if (!apiCache) {
        // Initialize cache to get stats
        const db = getDb().database
        apiCache = new ApiCache(db)
      }
      return apiCache.getCacheStats()
    })
  })
}
