import { shell } from 'electron'
import type { HandlerDependencies } from '../types'

/**
 * Shell IPC handlers
 * Channels: shell:openExternal, shell:showItemInFolder, shell:updateUserDomains
 *
 * Opens external URLs in the system browser with security validation.
 * Only HTTPS URLs on whitelisted domains are allowed.
 * Shows files in system file manager for export feedback.
 */

/** Built-in domains allowed for external link opening */
const ALLOWED_DOMAINS = [
  'github.com',
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
  ipcMain.handle('shell:updateUserDomains', async (_event, domains: string[]): Promise<void> => {
    userDomains = domains
  })

  ipcMain.handle(
    'shell:openExternal',
    async (_event, url: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const parsedUrl = new URL(url)

        // Only allow HTTPS protocol
        if (parsedUrl.protocol !== 'https:') {
          return { success: false, error: 'Only HTTPS URLs allowed' }
        }

        // Check domain whitelist
        if (!isDomainAllowed(parsedUrl.hostname)) {
          return { success: false, error: 'Domain not allowed' }
        }

        await shell.openExternal(url)
        return { success: true }
      } catch {
        return { success: false, error: 'Invalid URL' }
      }
    }
  )

  /**
   * Show file in system file manager
   * Used for export feedback ("Open folder" action)
   */
  ipcMain.handle('shell:showItemInFolder', async (_event, filePath: string) => {
    shell.showItemInFolder(filePath)
    return { success: true }
  })
}
