import { ipcMain } from 'electron'
import { wrapHandler } from '../errorHandler'
import { getDatabaseService } from '../../database'
import { HpoApiClient } from '../../services/api/HpoApiClient'
import { ApiCache } from '../../services/api/ApiCache'
import { networkStatus } from '../../services/network/NetworkStatus'

/**
 * HPO IPC handlers
 * Channels: hpo:search, hpo:clearCache
 */

// Singleton instances - lazy initialization
let hpoClient: HpoApiClient | null = null
let apiCache: ApiCache | null = null

function getHpoClient(): HpoApiClient {
  if (!hpoClient) {
    const db = getDatabaseService().database
    apiCache = new ApiCache(db)
    hpoClient = new HpoApiClient(apiCache)
  }
  return hpoClient
}

/**
 * Search HPO terms
 * Checks network status and returns cached data if offline
 */
ipcMain.handle('hpo:search', async (_event, query: string, maxResults?: number) => {
  return wrapHandler(async () => {
    const client = getHpoClient()
    const isOnline = networkStatus.getStatus()

    // If offline, try to get cached data
    if (!isOnline) {
      const cached = client.getCached(query, maxResults ?? 20)

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
    return await client.search(query, maxResults)
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
