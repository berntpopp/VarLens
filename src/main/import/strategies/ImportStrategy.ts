import type { DatabaseService } from '../../database/DatabaseService'
import type { ImportOptions, ImportResult } from '../types'

/**
 * File format types supported by import strategies
 */
export type FileFormat = 'columnar' | 'object' | 'simple' | 'vcf'

/**
 * Format detection result from detectFormat()
 */
export interface FormatInfo {
  format: FileFormat
  /** For columnar: case ID key. For object: first sample ID. For simple: 'variants' */
  caseKey: string
  /** For columnar: whether data/header are wrapped under caseKey (default true) */
  wrapped?: boolean
}

/**
 * Context passed to strategy.import()
 */
export interface StrategyContext {
  /** Database service for case creation and variant insertion */
  db: DatabaseService
  /** Pre-detected format information */
  formatInfo: FormatInfo
  /** Case ID (created before strategy runs) */
  caseId: number
  /** Import start time for elapsed calculation */
  startTime: number
}

/**
 * Import strategy interface - each format implements this
 */
export interface ImportStrategy {
  /** Unique format identifier */
  readonly formatId: FileFormat

  /**
   * Check if this strategy can handle the given format
   * @param formatInfo - Detected format information
   */
  canHandle(formatInfo: FormatInfo): boolean

  /**
   * Execute the import for this format
   * @param filePath - Path to the .json.gz file
   * @param options - Import options (caseName, batchSize, callbacks)
   * @param context - Strategy context with db, formatInfo, caseId, startTime
   * @returns Import result with statistics
   */
  import(filePath: string, options: ImportOptions, context: StrategyContext): Promise<ImportResult>
}
