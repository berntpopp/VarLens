// Progress update for import callbacks
export interface ProgressUpdate {
  phase: 'reading' | 'parsing' | 'inserting'
  count: number // Variants processed so far
  elapsed: number // Milliseconds since start
  skipped?: number // Variants skipped due to validation errors
}

// Callback type for progress reporting
export type ProgressCallback = (update: ProgressUpdate) => void

// Options for import operation
export interface ImportOptions {
  caseName: string // Name for the case record
  onProgress?: ProgressCallback
  signal?: AbortSignal // For cancellation support
  batchSize?: number // Override default 5000
}

// Result of import operation
export interface ImportResult {
  caseId: number
  variantCount: number
  skipped: number
  errors: string[] // Summary error messages
  elapsed: number // Total time in ms
}

// Field mapping definition
export interface FieldMapping {
  source: string // Source column name (for header lookup)
  sourceIndex: number // Direct index into data array
  target: string // Target property name (matches Variant type)
  isMultiValue: boolean // True if array that needs transcript selection
  hasDictionary: boolean // True if needs data dictionary lookup
}

// Raw variant row from columnar format (before mapping)
// This is a tuple: [value1, value2, ...] indexed by column
export type RawVariantRow = (string | number | null | (string | number | null)[])[]
