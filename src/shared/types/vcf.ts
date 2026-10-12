/**
 * VCF preview result DTO for renderer consumption.
 *
 * Mirrors the actual shape returned by import:vcfPreview IPC channel.
 * Main-side VcfPreviewResult in src/main/import/vcf/types.ts must match this.
 */

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
  genomeBuild: string
  caseNames: Map<string, string>
  /** Every selected sample has a non-empty, new and unique case name. */
  valid: boolean
}

export interface VcfPreviewResult {
  fileformat: string
  samples: string[]
  variantCountEstimate: number
  annotationType: VcfAnnotationType
  detectedGenomeBuild: string | null
  infoFields: VcfPreviewInfoField[]
}
