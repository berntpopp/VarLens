/**
 * Log types and constants for Varlens logging infrastructure
 */

/**
 * Log severity levels
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'critical'

/**
 * Log entry structure
 */
export interface LogEntry {
  id: number
  timestamp: number
  level: LogLevel
  message: string
  source?: string
}

/**
 * Log statistics tracking
 */
export interface LogStatistics {
  totalReceived: number
  totalDropped: number
  debugCount: number
  infoCount: number
  warnCount: number
  errorCount: number
  criticalCount: number
}

/**
 * Log configuration
 */
export interface LogConfig {
  maxEntries: number
  minLevel: LogLevel
}

/**
 * Ordered array of log levels
 */
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'critical'] as const

/**
 * Vuetify color mapping for each log level
 */
export const LOG_LEVEL_COLORS: Record<LogLevel, string> = {
  debug: 'grey',
  info: 'blue',
  warn: 'amber',
  error: 'red',
  critical: 'deep-purple'
}
