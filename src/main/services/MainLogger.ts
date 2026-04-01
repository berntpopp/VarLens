/**
 * MainLogger - Singleton logger for main process
 * Logs to console/file via electron-log AND sends to renderer via IPC.
 *
 * Worker-thread safe: when imported from a worker thread (where `electron`
 * is unavailable), falls back to console logging. This allows repositories
 * like CaseRepository and VariantRepository to import mainLogger without
 * crashing in db-worker/delete-worker contexts.
 *
 * Log file locations (electron-log defaults, main process only):
 * - Linux:   ~/.config/varlens/logs/main.log
 * - macOS:   ~/Library/Logs/varlens/main.log
 * - Windows: %APPDATA%\varlens\logs\main.log
 *
 * Rotation: when main.log exceeds 5 MB it is renamed to main.old.log.
 */

import { isMainThread } from 'worker_threads'
import type { LogMessage } from '../../shared/types/log'

// Lazy-loaded references — only populated in the main thread
let log: typeof import('electron-log/main').default | null = null
let BrowserWindow: typeof import('electron').BrowserWindow | null = null

if (isMainThread) {
  try {
    // Dynamic require so the module is never loaded in worker threads.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    log = require('electron-log/main') as typeof import('electron-log/main').default
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    BrowserWindow = (require('electron') as typeof import('electron')).BrowserWindow

    // Configure electron-log transports
    log.transports.file.level = 'info'
    log.transports.file.maxSize = 5 * 1024 * 1024 // 5 MB before rotation
    log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}'
    log.transports.console.level = 'debug'
  } catch (e) {
    // electron-log or electron not available — fall back to console
    console.warn(
      '[MainLogger] electron-log/electron not available, falling back to console:',
      e instanceof Error ? e.message : String(e)
    )
    log = null
    BrowserWindow = null
  }
}

/**
 * MainLogger class - wraps electron-log with IPC emission.
 * Falls back to console in worker threads.
 */
export class MainLogger {
  private static instance: MainLogger | null = null

  private constructor() {
    // Initialize electron-log for main process (no-op in workers)
    if (log) {
      log.initialize()
    }
  }

  static getInstance(): MainLogger {
    if (MainLogger.instance === null) {
      MainLogger.instance = new MainLogger()
    }
    return MainLogger.instance
  }

  /**
   * Get the path to the current log file.
   * Returns empty string in worker threads.
   */
  getLogFilePath(): string {
    if (!log) return ''
    return log.transports.file.getFile().path
  }

  private emit(level: LogMessage['level'], message: string, source: string): void {
    if (!BrowserWindow) return

    const logMessage: LogMessage = {
      timestamp: Date.now(),
      level,
      message,
      source
    }

    // Send to all renderer windows
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send('logs:message', logMessage)
      }
    })
  }

  debug(message: string, source = 'main'): void {
    if (log) {
      log.debug(`[${source}] ${message}`)
    } else {
      // Worker thread: console is the only option (allowed per CLAUDE.md)
      console.debug(`[${source}] ${message}`)
    }
    this.emit('debug', message, source)
  }

  info(message: string, source = 'main'): void {
    if (log) {
      log.info(`[${source}] ${message}`)
    } else {
      console.info(`[${source}] ${message}`)
    }
    this.emit('info', message, source)
  }

  warn(message: string, source = 'main'): void {
    if (log) {
      log.warn(`[${source}] ${message}`)
    } else {
      console.warn(`[${source}] ${message}`)
    }
    this.emit('warn', message, source)
  }

  error(message: string, source = 'main'): void {
    if (log) {
      log.error(`[${source}] ${message}`)
    } else {
      console.error(`[${source}] ${message}`)
    }
    this.emit('error', message, source)
  }
}

// Export singleton instance for convenience
export const mainLogger = MainLogger.getInstance()
