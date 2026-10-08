import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import { VepApiClient, vepCacheKey } from '../../services/api/VepApiClient'
import { ApiCache } from '../../services/api/ApiCache'
import { apiFixturesEnabled } from '../../services/api/ApiFixtureLoader'
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
      if (!apiFixturesEnabled()) {
        apiCache = new ApiCache(() => getDb().database)
      }
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
          const { chr, pos, ref, alt } = validated.data
          const cacheKey = vepCacheKey(chr, pos, ref, alt)
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
        if (apiFixturesEnabled()) {
          return { vepCount: 0, hpoCount: 0, totalBytes: 0 }
        }
        // Initialize cache to get stats
        apiCache = new ApiCache(() => getDb().database)
      }
      return apiCache.getCacheStats()
    })
  })
}
