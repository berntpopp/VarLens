import { z } from 'zod'
import { shell } from 'electron'
import type { HandlerDependencies } from '../types'
import { mainLogger } from '../../services/MainLogger'
import { wrapHandler } from '../errorHandler'
import { setUserDomains, isUrlSafeForExternal } from '../../utils/url-validation'

/**
 * Shell IPC handlers
 * Channels: shell:openExternal, shell:updateUserDomains
 *
 * Opens external URLs in the system browser with security validation.
 * Only HTTPS URLs on whitelisted domains are allowed.
 */

/** Schema for URL string */
const UrlSchema = z.string().min(1).max(2048)

/** Schema for user domains array */
const UserDomainsSchema = z.array(z.string().min(1).max(253)).max(100)

export function registerShellHandlers({ ipcMain }: HandlerDependencies): void {
  ipcMain.handle('shell:updateUserDomains', async (_event, domains: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = UserDomainsSchema.safeParse(domains)
      if (!validated.success) {
        mainLogger.error(
          `Invalid shell:updateUserDomains params: ${validated.error.message}`,
          'shell'
        )
        throw new Error('Invalid parameters')
      }
      setUserDomains(validated.data)
    })
  })

  ipcMain.handle('shell:openExternal', async (_event, url: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = UrlSchema.safeParse(url)
      if (!validated.success) {
        mainLogger.error(`Invalid shell:openExternal params: ${validated.error.message}`, 'shell')
        throw new Error('Invalid parameters')
      }

      if (!isUrlSafeForExternal(validated.data)) {
        return { success: false, error: 'URL not allowed' }
      }

      await shell.openExternal(validated.data)
      return { success: true }
    })
  })
}
