import { z } from 'zod'
import { shell } from 'electron'
import type { HandlerDependencies } from '../types'
import { mainLogger } from '../../services/MainLogger'
import { wrapHandler } from '../errorHandler'
import { InvalidParametersError } from '../errors'
import { setUserDomains, isUrlSafeForExternal } from '../../utils/url-validation'
import { isStrictlyEnrolledPath } from '../../security/import-path-allowlist'

/**
 * Shell IPC handlers
 * Channels: shell:openExternal, shell:showItemInFolder, shell:updateUserDomains
 *
 * Opens external URLs in the system browser with security validation.
 * Only HTTPS URLs on whitelisted domains are allowed.
 * Shows files in system file manager for export feedback.
 */

/** Schema for URL string */
const UrlSchema = z.string().min(1).max(2048)

/** Schema for file path string */
const FilePathSchema = z.string().min(1).max(1024)

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

  /**
   * Show file in system file manager
   * Used for export feedback ("Open folder" action). The path always
   * originates from a path this session's dialogs produced (an export
   * save-dialog result, a picked import/BED/database file, ...), so it must
   * be strictly dialog-enrolled -- the automatic home/userData/temp roots
   * `isAllowedImportPath` grants for the import flow do not apply here, so
   * an arbitrary renderer-supplied path under those roots is still rejected.
   */
  ipcMain.handle('shell:showItemInFolder', async (_event, filePath: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = FilePathSchema.safeParse(filePath)
      if (!validated.success) {
        mainLogger.error(
          `Invalid shell:showItemInFolder params: ${validated.error.message}`,
          'shell'
        )
        throw new Error('Invalid parameters')
      }

      if (!isStrictlyEnrolledPath(validated.data)) {
        throw new InvalidParametersError(
          `shell:showItemInFolder: filePath is not in the allowed import paths: ${validated.data}`,
          'The selected file is not in an allowed location.'
        )
      }

      shell.showItemInFolder(validated.data)
      return { success: true }
    })
  })
}
