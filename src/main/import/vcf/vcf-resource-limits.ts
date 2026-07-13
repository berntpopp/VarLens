/** Practical allocation/fan-out budgets applied before VCF token arrays or maps are built. */
export const MAX_VCF_ALT_ALLELES = 1_000
export const MAX_VCF_INFO_CHARS = 1024 * 1024
export const MAX_VCF_INFO_FIELDS = 4_096
export const MAX_VCF_FORMAT_FIELDS = 256
export const MAX_VCF_FORMAT_CHARS = 64 * 1024
export const MAX_VCF_SAMPLE_FIELD_CHARS = 64 * 1024
/** Bounds JS token/map overhead while allowing cohorts well beyond the former 10k cap. */
export const MAX_VCF_HEADER_SAMPLES = 100_000
/** Legacy direct callers may request all samples; production resolves exactly one sample. */
export const MAX_VCF_COMPATIBILITY_SAMPLES = MAX_VCF_HEADER_SAMPLES
export const MAX_VCF_ANNOTATION_CHARS = 1024 * 1024
export const MAX_VCF_ANNOTATIONS = 2_048
export const MAX_VCF_ANNOTATION_FIELDS = 256
export const MAX_VCF_TOTAL_ANNOTATION_VALUES = 100_000
export const MAX_VCF_STRUCTURED_HEADER_CHARS = 256 * 1024
export const MAX_VCF_STRUCTURED_HEADER_FIELDS = 256
export const MAX_VCF_GENOTYPE_ALLELES = 64

export class VcfResourceLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VcfResourceLimitError'
  }
}

/** Native split honors its limit and stops tokenizing once the sentinel part is reached. */
export function splitBounded(value: string, delimiter: string, maxParts: number): string[] | null {
  const parts = value.split(delimiter, maxParts + 1)
  return parts.length > maxParts ? null : parts
}

export function splitGenotypeAlleles(value: string): string[] | null {
  const parts = value.split(/[/|]/, MAX_VCF_GENOTYPE_ALLELES + 1)
  return parts.length > MAX_VCF_GENOTYPE_ALLELES ? null : parts
}
