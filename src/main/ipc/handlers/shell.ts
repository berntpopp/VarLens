import { ipcMain, shell } from 'electron'

/**
 * Shell IPC handlers
 * Channels: shell:openExternal
 *
 * Opens external URLs in the system browser with security validation.
 * Only HTTPS URLs on whitelisted domains are allowed.
 */

/** Domains allowed for external link opening */
const ALLOWED_DOMAINS = ['github.com', 'opensource.org']

/**
 * Check if hostname matches an allowed domain exactly or is a subdomain of it.
 */
function isDomainAllowed(hostname: string): boolean {
  return ALLOWED_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
}

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
