/**
 * VCF preview result DTO for renderer consumption.
 *
 * Mirrors the actual shape returned by import:vcfPreview IPC channel.
 * Main-side VcfPreviewResult in src/main/import/vcf/types.ts must match this.
 */

import type { BuildDetection } from '../genome/genome-build'

/** Annotation type detected from VCF header */
export type VcfAnnotationType = 'csq' | 'ann' | 'none'

export interface VcfPreviewInfoField {
  id: string
  type: string
  number: string
  description: string
  mapsToColumn: string | null
}

/** Samples and case names chosen in the VCF preview step. */
export interface VcfSampleSelection {
  selectedSamples: string[]
  /** Null until the user confirms a build (GenomeBuildField); never defaulted. */
  genomeBuild: string | null
  caseNames: Map<string, string>
  /** Every selected sample has a non-empty, new and unique case name. */
  valid: boolean
}

export interface VcfPreviewResult {
  fileformat: string
  samples: string[]
  variantCountEstimate: number
  annotationType: VcfAnnotationType
  /** Build the file decides on its own (definitive or strong), else null. */
  detectedGenomeBuild: string | null
  /** Suggested build with evidence; the user confirms it in the import UI. */
  buildDetection: BuildDetection
  infoFields: VcfPreviewInfoField[]
}
