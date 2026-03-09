import { z } from 'zod'
import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import { HpoApiClient } from '../../services/api/HpoApiClient'
import { ApiCache } from '../../services/api/ApiCache'
import { networkStatus } from '../../services/network/NetworkStatus'
import { mainLogger } from '../../services/MainLogger'

/** Schema for HPO search parameters */
const HpoSearchParamsSchema = z.object({
  query: z.string().min(1).max(500),
  maxResults: z.number().int().positive().max(100).optional()
})

/**
 * HPO IPC handlers
 * Channels: hpo:search, hpo:clearCache
 */

// Singleton instances - lazy initialization
let hpoClient: HpoApiClient | null = null
let apiCache: ApiCache | null = null

export function registerHpoHandlers({ ipcMain, getDb }: HandlerDependencies): void {
  function getHpoClient(): HpoApiClient {
    if (!hpoClient) {
      const db = getDb().database
      apiCache = new ApiCache(db)
      hpoClient = new HpoApiClient(apiCache)
    }
    return hpoClient
  }

  /**
   * Search HPO terms
   * Checks network status and returns cached data if offline
   */
  ipcMain.handle('hpo:search', async (_event, query: unknown, maxResults?: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = HpoSearchParamsSchema.safeParse({ query, maxResults })
      if (!validated.success) {
        mainLogger.error(`Invalid hpo:search params: ${validated.error.message}`, 'hpo')
        throw new Error('Invalid parameters')
      }

      const client = getHpoClient()
      const isOnline = networkStatus.getStatus()

      // If offline, try to get cached data
      if (!isOnline) {
        const cached = client.getCached(validated.data.query, validated.data.maxResults ?? 20)

        if (cached) {
          return {
            success: true,
            terms: cached
          }
        }

        // No cache available while offline
        return {
          success: false,
          error: 'No network connection and no cached data available',
          offline: true
        }
      }

      // Online - search normally (will use cache if available)
      return await client.search(validated.data.query, validated.data.maxResults)
    })
  })

  /**
   * Clear HPO cache
   * Called from settings page
   */
  ipcMain.handle('hpo:clearCache', async () => {
    return wrapHandler(async () => {
      if (hpoClient) {
        hpoClient.clearCache()
      }
      return { success: true }
    })
  })
}
