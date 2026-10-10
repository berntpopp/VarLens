/**
 * External database URL builders
 *
 * Pure functions that construct URLs for external genomic databases from variant data.
 * Each function returns string | null (null when required data is missing).
 */

/** Genome build type for variant data */
export type GenomeBuild = 'GRCh37' | 'GRCh38'

/**
 * Build OMIM entry page URL by MIM number
 * @param mimNumber - OMIM MIM number
 * @returns OMIM entry URL or null if MIM number missing
 */
export function buildOmimUrl(mimNumber: string | null): string | null {
  if (mimNumber == null || mimNumber === '') {
    return null
  }

  const encodedMim = encodeURIComponent(mimNumber)
  return `https://omim.org/entry/${encodedMim}`
}

/**
 * Variant data interface for URL template resolution
 */
export interface VariantLinkData {
  chr: string | null
  pos: number | null
  ref: string | null
  alt: string | null
  gene_symbol: string | null
  mim_number?: string | null
}

/**
 * Resolve a URL template with variant data
 * @param template - URL template with variable placeholders
 * @param data - Variant data to substitute
 * @param build - Genome build
 * @param requiredFields - List of required field names
 * @returns Resolved URL or null if required data missing
 */
export function resolveUrlTemplate(
  template: string,
  data: VariantLinkData,
  build: GenomeBuild,
  requiredFields: string[]
): string | null {
  // Map field names to data values
  const fieldMap: Record<string, string | number | null | undefined> = {
    chr: data.chr,
    pos: data.pos,
    ref: data.ref,
    alt: data.alt,
    gene: data.gene_symbol,
    mim_number: data.mim_number
  }

  // Check required fields are present and valid
  for (const fieldName of requiredFields) {
    const value = fieldMap[fieldName]
    if (value == null || value === '' || value === 0) {
      return null
    }
  }

  // Build variable map for substitution
  const buildUcsc = build === 'GRCh37' ? 'hg19' : 'hg38'
  const datasetGnomad = build === 'GRCh37' ? 'gnomad_r2_1' : 'gnomad_r4'
  const posStart = Math.max(1, (data.pos ?? 0) - 25)
  const posEnd = (data.pos ?? 0) + 25

  const variables: Record<string, string> = {
    chr: String(data.chr ?? ''),
    pos: String(data.pos ?? ''),
    ref: encodeURIComponent(data.ref ?? ''),
    alt: encodeURIComponent(data.alt ?? ''),
    gene: encodeURIComponent(data.gene_symbol ?? ''),
    mim_number: encodeURIComponent(data.mim_number ?? ''),
    build: build,
    build_ucsc: buildUcsc,
    dataset_gnomad: datasetGnomad,
    pos_start: String(posStart),
    pos_end: String(posEnd)
  }

  // Replace all variables in template
  let resolved = template
  for (const [key, value] of Object.entries(variables)) {
    resolved = resolved.split(`{${key}}`).join(value)
  }

  return resolved
}
