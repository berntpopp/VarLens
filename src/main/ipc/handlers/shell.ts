import { ipcMain, shell } from 'electron'

/**
 * Shell IPC handlers
 * Channels: shell:openExternal
 *
 * Opens external URLs in the system browser with security validation.
 * Only HTTPS URLs on whitelisted domains are allowed.
 */

/** Built-in domains allowed for external link opening */
const ALLOWED_DOMAINS = [
  'github.com',
  'opensource.org',
  'gnomad.broadinstitute.org',
  'ncbi.nlm.nih.gov',
  'omim.org',
  'genome.ucsc.edu',
  'varsome.com',
  'franklin.genoox.com'
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

ipcMain.handle(
  'shell:updateUserDomains',
  async (_event, domains: string[]): Promise<void> => {
    userDomains = domains
  }
)

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
