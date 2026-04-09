/**
 * VCF import type definitions.
 *
 * These types model the VCF file format structures used throughout the
 * VCF import pipeline: header parsing, line parsing, genotype extraction,
 * annotation parsing, INFO field mapping, and final variant assembly.
 */

import type { TranscriptInsertRow } from '../../../shared/types/transcript'
import type { AnnotationType } from '../../../shared/types/import'

export type { AnnotationType, VcfPreviewResult } from '../../../shared/types/import'

// ── Header types ─────────────────────────────────────────────

/** VCF INFO field definition parsed from ## header */
export interface InfoFieldDef {
  id: string
  number: string // "0", "1", "A", "R", "G", "."
  type: 'Integer' | 'Float' | 'Flag' | 'Character' | 'String'
  description: string
}

/** VCF FORMAT field definition parsed from ## header */
export interface FormatFieldDef {
  id: string
  number: string
  type: 'Integer' | 'Float' | 'Character' | 'String'
  description: string
}

/** Contig definition from ##contig header line */
export interface ContigDef {
  id: string
  length?: number
}

/** Parsed VCF header -- produced by vcf-header-parser */
export interface VcfHeader {
  /** VCF version string, e.g. "VCFv4.2" */
  fileformat: string
  /** Sample names from #CHROM line (columns 10+) */
  samples: string[]
  /** INFO field definitions keyed by ID */
  infoDefs: Map<string, InfoFieldDef>
  /** FORMAT field definitions keyed by ID */
  formatDefs: Map<string, FormatFieldDef>
  /** Contig definitions keyed by ID */
  contigs: Map<string, ContigDef>
  /** Auto-detected annotation type */
  annotationType: AnnotationType
  /** CSQ Format subfield names (only if annotationType === 'csq') */
  csqFields: string[] | null
  /** Detected genome build from ##reference or ##contig lines */
  genomeBuild: string | null
  /** Raw header lines (for genome build detection) */
  rawHeaderLines: string[]
}

// ── Line parser types ────────────────────────────────────────

/** Raw VCF data record -- one line parsed into structured fields */
export interface VcfRawRecord {
  /** Chromosome */
  chrom: string
  /** 1-based position */
  pos: number
  /** Variant ID (rs number) or null if "." */
  id: string | null
  /** Reference allele */
  ref: string
  /** Alternate alleles (split on comma) */
  alt: string[]
  /** Quality score or null if "." */
  qual: number | null
  /** FILTER value -- "PASS" or semicolon-separated filter names */
  filter: string
  /** Raw INFO key-value pairs (unparsed string values) */
  info: Map<string, string>
  /** FORMAT field order, e.g. ["GT", "GQ", "DP", "AD"] */
  format: string[]
  /** Per-sample values keyed by sample name, values matching format order */
  samples: Map<string, string[]>
}

// ── Genotype types ───────────────────────────────────────────

/** Parsed genotype data for one sample at one site */
export interface GenotypeData {
  /** Genotype string, e.g. "0/1", "1/1", "./.", "1" (hemizygous) */
  gt: string
  /** Genotype quality */
  gq: number | null
  /** Read depth */
  dp: number | null
  /** Reference allele depth */
  adRef: number | null
  /** Alternate allele depth */
  adAlt: number | null
  /** Allele balance: adAlt / (adRef + adAlt) */
  ab: number | null
}

// ── Annotation types ─────────────────────────────────────────

/** Result of parsing CSQ or ANN annotations for one allele */
export interface AnnotationResult {
  /** Selected transcript values (copied to main variant row) */
  geneSymbol: string | null
  consequence: string | null
  impact: string | null
  transcript: string | null
  cdna: string | null
  aaChange: string | null
  gnomadAf: number | null
  cadd: number | null
  clinvar: string | null

  /** All transcripts for variant_transcripts table */
  transcripts: TranscriptInsertRow[]
}

// ── INFO field mapping types ─────────────────────────────────

/** Mapping from VCF INFO field IDs to VarLens variant columns */
export interface InfoFieldMapping {
  /** One or more INFO field IDs that map to this column (first match wins) */
  infoIds: string[]
  /** Target column on the variants table */
  column: string
  /** How to parse the raw string value */
  type: 'float' | 'integer' | 'string'
  /** Optional: which CSQ subfield also maps here (for deduplication) */
  csqField?: string
  /** Human-readable description */
  description: string
}

/** Result of applying the INFO field registry to one variant */
export interface InfoFieldResult {
  /** Mapped column values (column name -> parsed value) */
  mappedValues: Map<string, string | number | null>
  /** Unmapped fields assembled into a JSON object */
  infoJson: Record<string, string> | null
}

// ── VcfMapper output ─────────────────────────────────────────

/** A fully mapped variant ready for BatchAccumulator, including VCF-specific fields */
export interface VcfMappedVariant {
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
  hpo_match: string | null
  moi: string | null
  gq: number | null
  dp: number | null
  ad_ref: number | null
  ad_alt: number | null
  ab: number | null
  filter: string | null
  info_json: string | null
  source_format: string | null
  _transcripts?: TranscriptInsertRow[]

  /** Variant type discriminator */
  variant_type: string
  /** End position for SV/CNV/STR */
  end_pos: number | null
  /** SV type: DEL, DUP, INV, INS, BND */
  sv_type: string | null
  /** SV length */
  sv_length: number | null
  /** Detected caller name */
  caller: string | null
  /** SV extension data */
  _sv?: import('./extension-parsers').SvExtensionRow
  /** CNV extension data */
  _cnv?: import('./extension-parsers').CnvExtensionRow
  /** STR extension data */
  _str?: import('./extension-parsers').StrExtensionRow
}

// ── Preview / import option types ────────────────────────────

// VcfPreviewResult and AnnotationType are re-exported from shared/types/import above

/** VCF-specific import options extending the base ImportOptions */
export interface VcfImportOptions {
  /** Which samples to import (from preview step) */
  selectedSamples: string[]
  /** User override of detected genome build */
  genomeBuild?: string
  /** Custom case names per sample (key = sample name, value = case name) */
  caseNames?: Map<string, string>
}
