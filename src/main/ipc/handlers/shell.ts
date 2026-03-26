import { z } from 'zod'
import { shell } from 'electron'
import type { HandlerDependencies } from '../types'
import { mainLogger } from '../../services/MainLogger'
import { wrapHandler } from '../errorHandler'

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
const UserDomainsSchema = z.array(z.string().min(1).max(253))

/** Built-in domains allowed for external link opening */
const ALLOWED_DOMAINS = [
  'github.com',
  'github.io',
  'opensource.org',
  'gnomad.broadinstitute.org',
  'ncbi.nlm.nih.gov', // Covers PubTator, LitVar, ClinVar
  'omim.org',
  'genome.ucsc.edu',
  'varsome.com',
  'franklin.genoox.com',
  // New for Phase 23
  'deciphergenomics.org', // DECIPHER
  'clinicalgenome.org', // ClinGen
  'ensembl.org', // Ensembl
  'grch37.ensembl.org' // Ensembl GRCh37 subdomain
]

/** User-configured domains (synced from renderer store) */
let userDomains: string[] = []

/**
 * Check if hostname matches an allowed domain exactly or is a subdomain of it.
 */
function isDomainAllowed(hostname: string): boolean {
  const allDomains = [...ALLOWED_DOMAINS, ...userDomains]
  return allDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
}

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
      userDomains = validated.data
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

      try {
        const parsedUrl = new URL(validated.data)

        // Only allow HTTPS protocol
        if (parsedUrl.protocol !== 'https:') {
          return { success: false, error: 'Only HTTPS URLs allowed' }
        }

        // Check domain whitelist
        if (!isDomainAllowed(parsedUrl.hostname)) {
          return { success: false, error: 'Domain not allowed' }
        }

        await shell.openExternal(validated.data)
        return { success: true }
      } catch {
        return { success: false, error: 'Invalid URL' }
      }
    })
  })

  /**
   * Show file in system file manager
   * Used for export feedback ("Open folder" action)
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

      shell.showItemInFolder(validated.data)
      return { success: true }
    })
  })
}
