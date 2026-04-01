/**
 * Message types for the export worker thread.
 * Follows the same pattern as import-worker.ts message types.
 *
 * Architecture: The main thread compiles the Kysely query and sends
 * the resulting SQL+parameters to the worker. The worker only handles
 * DB connection, query execution, and XLSX generation — no filter
 * logic duplication.
 */

/** Main thread → worker */
export type ExportMainMessage = {
  type: 'start'
  dbPath: string
  encryptionKey?: string
  /** Pre-compiled SQL from Kysely (includes WHERE, ORDER BY, LIMIT) */
  compiledSql: string
  /** Parameterized values for the compiled SQL */
  compiledParams: readonly unknown[]
  outputFilePath: string
  caseName: string
  /** Active filter summary for metadata sheet */
  filterSummary: ExportFilterSummary
  /** Export format — inferred from the output file extension in the main process */
  format: 'xlsx' | 'csv'
}

/** Summary of active filters for the Excel metadata sheet */
export interface ExportFilterSummary {
  gene_symbol?: string
  consequences?: string[]
  funcs?: string[]
  clinvars?: string[]
  gnomad_af_max?: number
  cadd_min?: number
}

/** Worker → main thread */
export type ExportWorkerMessage =
  | { type: 'progress'; current: number; total: number }
  | { type: 'complete'; filePath: string; rowCount: number }
  | { type: 'error'; error: string; stack?: string }
