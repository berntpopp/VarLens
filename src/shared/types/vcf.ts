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

export interface VcfPreviewResult {
  fileformat: string
  samples: string[]
  variantCountEstimate: number
  annotationType: VcfAnnotationType
  detectedGenomeBuild: string | null
  infoFields: VcfPreviewInfoField[]
  /** CSQ / ANN subfield names in header order. */
  annotationFields: string[]
}
