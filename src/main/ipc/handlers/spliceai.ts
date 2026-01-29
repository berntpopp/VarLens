import { ipcMain } from 'electron'
import { wrapHandler } from '../errorHandler'
import { getDatabaseService } from '../../database'
import { SpliceAIApiClient } from '../../services/api/SpliceAIApiClient'
import { ApiCache } from '../../services/api/ApiCache'
import { networkStatus } from '../../services/network/NetworkStatus'

/**
 * SpliceAI Lookup (Broad Institute) IPC handlers
 * Channels: spliceai:fetch, spliceai:clearCache
 */

// Singleton instances - lazy initialization
let spliceAIClient: SpliceAIApiClient | null = null
let apiCache: ApiCache | null = null

function getSpliceAIClient(): SpliceAIApiClient {
  if (!spliceAIClient) {
    const db = getDatabaseService().database
    apiCache = new ApiCache(db)
    spliceAIClient = new SpliceAIApiClient(apiCache)
  }
  return spliceAIClient
}

/**
 * Fetch SpliceAI scores from Broad Institute API
 * Returns delta scores for acceptor/donor gain/loss
 */
ipcMain.handle(
  'spliceai:fetch',
  async (_event, chr: string, pos: number, ref: string, alt: string) => {
    return wrapHandler(async () => {
      const client = getSpliceAIClient()
      const isOnline = networkStatus.getStatus()

      // If offline, try to get cached data
      if (!isOnline) {
        const normalizedChr = chr.replace(/^chr/i, '')
        const variantId = `${normalizedChr}-${pos}-${ref}-${alt}`
        const cacheKey = `spliceai:38:${variantId}`
        const cached = client.getCached(cacheKey)

        if (cached) {
          const scores = cached.data.scores
          if (scores && scores.length > 0) {
            // Use MANE Select or first score
            const score = scores.find((s) => s.t_priority === 'MS') ?? scores[0]
            return {
              success: true,
              scores: {
                max_delta: Math.max(
                  parseFloat(score.DS_AG),
                  parseFloat(score.DS_AL),
                  parseFloat(score.DS_DG),
                  parseFloat(score.DS_DL)
                ),
                ds_ag: parseFloat(score.DS_AG),
                ds_al: parseFloat(score.DS_AL),
                ds_dg: parseFloat(score.DS_DG),
                ds_dl: parseFloat(score.DS_DL),
                gene: score.g_name ?? null,
                transcript: score.t_id ?? null
              },
              cacheInfo: {
                cached: true,
                cachedAt: cached.createdAt
              }
            }
          }
        }

        return {
          success: false,
          error: 'No network connection and no cached data available',
          offline: true
        }
      }

      // Online - fetch normally
      return await client.fetchSpliceAIScores(chr, pos, ref, alt, '38')
    })
  }
)

/**
 * Clear SpliceAI cache
 */
ipcMain.handle('spliceai:clearCache', async () => {
  return wrapHandler(async () => {
    if (spliceAIClient) {
      spliceAIClient.clearCache()
    }
    return { success: true }
  })
})
