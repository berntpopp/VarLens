/**
 * LogService facade for application logging
 * Provides level-specific methods with automatic sanitization
 */

import { saveAs } from 'file-saver'
import { useLogStore } from '../stores/logStore'
import { sanitizeLogMessage } from '../utils/sanitizers'
import type { LogLevel } from '../types/log'

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
