import type { FieldOrigin } from '../config/import-fields.config'
import type { BuildDetection } from '../genome/genome-build'

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

/** What an import reports about its data; the values are stored as imported. */
export interface ImportDataReport {
  /** ClinVar values the severity configuration does not know (ranked as unknown). */
  unrankedClinvar?: string[]
  /** Variants whose gnomAD AF lies outside [0, 1]. */
  afOutOfRange?: number
}

// Result of import operation
export interface ImportResult extends ImportDataReport {
  caseId: number
  variantCount: number
  skipped: number
  errors: string[] // Summary error messages
  elapsed: number // Total time in ms
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

/** One source field in an import preview (spec §16 field table). */
export interface ImportFieldPreview {
  origin: FieldOrigin
  name: string
  /** The VarLens column it fills, or null when the field profile decides. */
  column: string | null
  /** number / text from the sampled values, else the header or catalogue type; '' when unknown. */
  type: string
  /** Share of sampled variants with a value (0..1); null when not sampled (VCF). */
  fillRate: number | null
  /** Up to three short sample values. */
  samples: string[]
  description?: string
}

/** JSON (columnar / object / simple) preview returned by import:jsonPreview. */
export interface JsonFieldPreviewResult {
  format: FileFormat
  /** Variants read for fill rates and samples (the first N of the file). */
  variantsScanned: number
  fields: ImportFieldPreview[]
}

/** Annotation type detected from VCF header */
export type AnnotationType = 'csq' | 'ann' | 'none'

/** VCF preview result returned by the import:vcfPreview IPC channel */
export interface VcfPreviewResult {
  fileformat: string
  samples: string[]
  variantCountEstimate: number
  annotationType: AnnotationType
  /** Build the file decides on its own (definitive or strong), else null. */
  detectedGenomeBuild: string | null
  /** Suggested build with evidence; the user confirms it in the import UI. */
  buildDetection: BuildDetection
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
  /** CSQ / ANN subfield names of the selected transcript, in header order. */
  annotationFields: string[]
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

/** File format types supported by import pipelines */
export type FileFormat = 'columnar' | 'object' | 'simple' | 'vcf'

/** Format detection result from detectFormat() */
export interface FormatInfo {
  format: FileFormat
  /** For columnar: case ID key. For object: first sample ID. For simple: 'variants' */
  caseKey: string
  /** For columnar: whether data/header are wrapped under caseKey (default true) */
  wrapped?: boolean
}
