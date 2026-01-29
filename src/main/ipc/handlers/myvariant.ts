import { ipcMain } from 'electron'
import { wrapHandler } from '../errorHandler'
import { getDatabaseService } from '../../database'
import { MyVariantApiClient } from '../../services/api/MyVariantApiClient'
import { ApiCache } from '../../services/api/ApiCache'
import { networkStatus } from '../../services/network/NetworkStatus'

/**
 * MyVariant.info IPC handlers
 * Channels: myvariant:fetch, myvariant:clearCache
 */

// Singleton instances - lazy initialization
let myVariantClient: MyVariantApiClient | null = null
let apiCache: ApiCache | null = null

function getMyVariantClient(): MyVariantApiClient {
  if (!myVariantClient) {
    const db = getDatabaseService().database
    apiCache = new ApiCache(db)
    myVariantClient = new MyVariantApiClient(apiCache)
  }
  return myVariantClient
}

/**
 * Fetch variant scores from myvariant.info
 * Returns REVEL, CADD, SIFT, PolyPhen, AlphaMissense scores
 */
ipcMain.handle(
  'myvariant:fetch',
  async (_event, chr: string, pos: number, ref: string, alt: string) => {
    return wrapHandler(async () => {
      const client = getMyVariantClient()
      const isOnline = networkStatus.getStatus()

      // If offline, try to get cached data
      if (!isOnline) {
        const normalizedChr = chr.replace(/^chr/i, '')
        const hgvs = `chr${normalizedChr}:g.${pos}${ref}>${alt}`
        const cacheKey = `myvariant:hg38:${hgvs}`
        const cached = client.getCached(cacheKey)

        if (cached) {
          return {
            success: true,
            scores: {
              revel_score: cached.data.dbnsfp?.revel?.score ?? null,
              cadd_phred: cached.data.dbnsfp?.cadd?.phred ?? null,
              sift_score: null,
              sift_pred: null,
              polyphen_score: null,
              polyphen_pred: null,
              alphamissense_score: null,
              alphamissense_pred: null
            },
            cacheInfo: {
              cached: true,
              cachedAt: cached.createdAt
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
      return await client.fetchVariantScores(chr, pos, ref, alt, 'hg38')
    })
  }
)

/**
 * Clear myvariant cache
 */
ipcMain.handle('myvariant:clearCache', async () => {
  return wrapHandler(async () => {
    if (myVariantClient) {
      myVariantClient.clearCache()
    }
    return { success: true }
  })
})
