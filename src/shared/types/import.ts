// Progress update for import callbacks
export interface ProgressUpdate {
  phase: 'reading' | 'parsing' | 'inserting'
  count: number // Variants processed so far (within the current file)
  elapsed: number // Milliseconds since start
  skipped?: number // Variants skipped due to validation errors
  // Multi-file session metadata: identifies WHICH file within a multi-file
  // import session this event belongs to. The orchestrator (`startMultiFileImport`)
  // injects these per file so the renderer no longer has to infer transitions
  // from "count reset" heuristics. Single-file imports omit both fields.
  fileIndex?: number
  totalFiles?: number
  filePath?: string
  fileName?: string
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

// Data dictionaries for field value resolution
export interface DataDictionaries {
  gene: Record<string, string> // Gene ID -> symbol
  impact: Record<string, string> // Impact code -> label
  transcript: Record<string, string> // Transcript ID -> name
  hpoSimScore: Record<string, number> // ID -> HPO similarity score
  moi: Record<string, string> // ID -> mode of inheritance abbreviation
}

// Batch import types
export type DuplicateChoice = 'skip' | 'overwrite'

export interface BatchImportOptions {
  duplicateStrategy: DuplicateChoice
  stripText?: string
  onBatchProgress?: (progress: {
    currentIndex: number
    totalFiles: number
    fileName: string
    overallPercent: number
  }) => void
  onFileProgress?: ProgressCallback
  signal?: AbortSignal
}

/** Annotation type detected from VCF header */
export type AnnotationType = 'csq' | 'ann' | 'none'

/** VCF preview result returned by the import:vcfPreview IPC channel */
export interface VcfPreviewResult {
  fileformat: string
  samples: string[]
  variantCountEstimate: number
  annotationType: AnnotationType
  detectedGenomeBuild: string | null
  infoFields: Array<{
    id: string
    type: string
    number: string
    description: string
    mapsToColumn: string | null
  }>
  /** Detected variant caller name from ##source= or ##command= header lines */
  callerName: string | null
  /** Caller version extracted from header (e.g., '2.6.3') */
  callerVersion: string | null
  /** Default variant type inferred from caller (snv, sv, cnv, str) */
  defaultVariantType: string
  /** Absolute file path (used for multi-file preview) */
  filePath: string
  /** File size in bytes */
  fileSize: number
}

/** Result of scanning multiple VCF files plus optional sibling BED files */
export interface VcfMultiPreviewResult {
  files: VcfPreviewResult[]
  /** Sibling BED files found in the same directory as the selected VCFs */
  siblingBedFiles: string[]
  /** Derived case name from sample ID (stripped of path + extension) */
  suggestedCaseName: string
}
