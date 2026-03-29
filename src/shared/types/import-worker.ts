import type { TranscriptInsertRow } from './transcript'

/**
 * Variant row for raw prepared-statement insertion (no Kysely).
 * Must stay in sync with the variants table schema.
 */
export interface VariantInsertRow {
  chr: string
  pos: number
  ref: string
  alt: string
  gene_symbol: string | null
  omim_mim_number: string | null
  consequence: string | null
  gnomad_af: number | null
  cadd: number | null
  clinvar: string | null
  gt_num: string | null
  func: string | null
  qual: number | null
  hpo_sim_score: number | null
  transcript: string | null
  cdna: string | null
  aa_change: string | null
  moi: string | null
  gq: number | null
  dp: number | null
  ad_ref: number | null
  ad_alt: number | null
  ab: number | null
  filter: string | null
  info_json: string | null
  source_format: string | null
}

/** Columns for the INSERT INTO variants (...) statement */
export const VARIANT_INSERT_COLUMNS = [
  'case_id',
  'chr',
  'pos',
  'ref',
  'alt',
  'gene_symbol',
  'omim_mim_number',
  'consequence',
  'gnomad_af',
  'cadd',
  'clinvar',
  'gt_num',
  'func',
  'qual',
  'hpo_sim_score',
  'transcript',
  'cdna',
  'aa_change',
  'moi',
  'gq',
  'dp',
  'ad_ref',
  'ad_alt',
  'ab',
  'filter',
  'info_json',
  'source_format'
] as const

/** Columns for the INSERT INTO variant_transcripts (...) statement */
export const TRANSCRIPT_INSERT_COLUMNS = [
  'variant_id',
  'transcript_id',
  'gene_symbol',
  'consequence',
  'cdna',
  'aa_change',
  'hpo_sim_score',
  'moi',
  'is_selected'
] as const

/** File import request sent from main to worker */
export interface FileImportRequest {
  filePath: string
  caseName: string
  isDuplicate: boolean
  duplicateStrategy: 'skip' | 'overwrite'
  /** VCF-specific: which samples to import */
  vcfSelectedSamples?: string[]
  /** VCF-specific: genome build override */
  vcfGenomeBuild?: string
}

/** Worker -> Main messages */
export type WorkerMessage =
  | {
      type: 'progress'
      fileIndex: number
      totalFiles: number
      fileName: string
      overallPercent: number
      phase: string
      variantCount: number
      skipped: number
    }
  | {
      type: 'file-complete'
      fileIndex: number
      result: {
        caseId: number
        caseName: string
        variantCount: number
        skipped: number
        elapsed: number
      }
    }
  | {
      type: 'complete'
      results: {
        succeeded: number
        failed: number
        skipped: number
        cancelled: boolean
        details: Array<{
          filePath: string
          fileName: string
          caseName: string
          status: 'success' | 'failed' | 'skipped'
          variantCount?: number
          error?: string
        }>
      }
    }
  | {
      type: 'error'
      fileIndex: number
      error: string
      phase: string
      stack?: string
    }

/** Main -> Worker messages */
export type MainMessage =
  | {
      type: 'start'
      files: FileImportRequest[]
      dbPath: string
      encryptionKey?: string
      throttleMs: number
      batchSize?: number
    }
  | {
      type: 'cancel'
    }

export type { TranscriptInsertRow }
