/**
 * Network status detection service
 *
 * Uses Electron's net module to detect online/offline state.
 * Provides point-in-time checks before making API calls.
 *
 * Future enhancement: Could add event-based detection if needed.
 */

import { net } from 'electron'

/**
 * NetworkStatus singleton service
 * Provides online/offline detection for API clients
 */
export class NetworkStatus {
  /**
   * Check current network status
   * Uses Electron's net.isOnline() which checks for network connectivity
   *
   * @returns true if online, false if offline
   */
  getStatus(): boolean {
    return net.isOnline()
  }
}

// Export singleton instance for use across handlers
export const networkStatus = new NetworkStatus()
