/**
 * LogService facade for application logging
 * Provides level-specific methods with automatic sanitization
 */

import { saveAs } from 'file-saver'
import { useLogStore } from '../stores/logStore'
import { useCapabilityStore } from '../stores/capabilityStore'
import { sanitizeLogMessage } from '../utils/sanitizers'
import type { LogLevel } from '../types/log'
import type { LogMessage } from '../../../shared/types/log'

// Lazy store initialization - only access store after Pinia is installed
let _store: ReturnType<typeof useLogStore> | null = null

function getStore() {
  if (_store === null) {
    _store = useLogStore()
  }
  return _store
}

/**
 * LogService class providing logging facade
 */
export class LogService {
  private cleanup: (() => void) | null = null

  /**
   * Initialize IPC listener for main process logs.
   * Call this once during app initialization.
   * Returns cleanup function for app unmount.
   */
  setupMainProcessListener(): void {
    // Guard against double initialization
    if (this.cleanup !== null) {
      return
    }

    // Main-process logs stream over IPC on desktop only; the web server's logs
    // go to the operator pipeline (capability `mainProcessLogs`).
    if (!useCapabilityStore().canUse('mainProcessLogs')) return

    this.cleanup = window.api.logs.onMessage((logMessage: LogMessage) => {
      this.log(logMessage.level, logMessage.message, logMessage.source)
    })
  }

  /**
   * Internal log method with sanitization
   */
  private log(level: LogLevel, message: string, source?: string): void {
    const sanitizedMessage = sanitizeLogMessage(message)
    getStore().addEntry({
      timestamp: Date.now(),
      level,
      message: sanitizedMessage,
      source
    })
  }

  /**
   * Log debug message
   */
  debug(message: string, source?: string): void {
    this.log('debug', message, source)
  }

  /**
   * Log info message
   */
  info(message: string, source?: string): void {
    this.log('info', message, source)
  }

  /**
   * Log warning message
   */
  warn(message: string, source?: string): void {
    this.log('warn', message, source)
  }

  /**
   * Log error message
   */
  error(message: string, source?: string): void {
    this.log('error', message, source)
  }

  /**
   * Log critical message
   */
  critical(message: string, source?: string): void {
    this.log('critical', message, source)
  }

  /**
   * Export logs to JSON file
   */
  exportLogs(): void {
    const store = getStore()
    const exportData = {
      exportedAt: new Date().toISOString(),
      appVersion: '0.2.0',
      stats: store.stats,
      entries: store.entries
    }

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json;charset=utf-8'
    })

    saveAs(blob, `varlens-logs-${Date.now()}.json`)
  }

  /**
   * Clear all log entries
   */
  clearLogs(): void {
    getStore().clear()
  }
}

/**
 * Singleton instance of LogService
 */
export const logService = new LogService()
