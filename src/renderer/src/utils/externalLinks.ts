/**
 * External database URL builders
 *
 * Pure functions that construct URLs for external genomic databases from variant data.
 * Each function returns string | null (null when required data is missing).
 *
 * Design principles:
 * - Zero side effects (no DOM, no IPC, no imports)
 * - Synchronous pure functions
 * - Strict null/empty checking
 * - URL encoding for user-data components
 * - Genome-build-aware URL construction
 */

/** Genome build type for variant data */
export type GenomeBuild = 'GRCh37' | 'GRCh38'

/**
 * Build gnomAD variant page URL
 * @param chr - Chromosome (e.g., "1", "X", "MT")
 * @param pos - Genomic position (1-based)
 * @param ref - Reference allele
 * @param alt - Alternate allele
 * @param build - Genome build
 * @returns gnomAD URL or null if required data missing
 */
export function buildGnomadUrl(
  chr: string | null,
  pos: number | null,
  ref: string | null,
  alt: string | null,
  build: GenomeBuild
): string | null {
  // Strict checks: treat empty string, 0, null, undefined as missing
  if (
    chr == null ||
    chr === '' ||
    pos == null ||
    pos <= 0 ||
    ref == null ||
    ref === '' ||
    alt == null ||
    alt === ''
  ) {
    return null
  }

  // Select dataset based on genome build
  const dataset = build === 'GRCh37' ? 'gnomad_r2_1' : 'gnomad_r4'

  // Encode ref/alt (handles indels with special chars)
  const encodedRef = encodeURIComponent(ref)
  const encodedAlt = encodeURIComponent(alt)

  return `https://gnomad.broadinstitute.org/variant/${chr}-${pos}-${encodedRef}-${encodedAlt}?dataset=${dataset}`
}

/**
 * Build ClinVar variation page URL by ID
 * @param clinvarId - ClinVar variation ID
 * @returns ClinVar URL or null if ID missing
 * @note For future use when ClinVar ID is available in schema (Phase 17+)
 */
export function buildClinvarUrl(clinvarId: string | null): string | null {
  if (clinvarId == null || clinvarId === '') {
    return null
  }

  const encodedId = encodeURIComponent(clinvarId)
  return `https://www.ncbi.nlm.nih.gov/clinvar/variation/${encodedId}/`
}

/**
 * Build ClinVar coordinate-based search URL
 * @param chr - Chromosome
 * @param pos - Genomic position
 * @param ref - Reference allele
 * @param alt - Alternate allele
 * @returns ClinVar search URL or null if required data missing
 * @note Primary ClinVar link for Phase 15 (Variant interface lacks clinvar_id)
 */
export function buildClinvarSearchUrl(
  chr: string | null,
  pos: number | null,
  ref: string | null,
  alt: string | null
): string | null {
  if (
    chr == null ||
    chr === '' ||
    pos == null ||
    pos <= 0 ||
    ref == null ||
    ref === '' ||
    alt == null ||
    alt === ''
  ) {
    return null
  }

  // Construct search term: chr:pos:ref:alt
  const searchTerm = `${chr}:${pos}:${ref}:${alt}`
  const encodedTerm = encodeURIComponent(searchTerm)

  return `https://www.ncbi.nlm.nih.gov/clinvar/?term=${encodedTerm}`
}

/**
 * Build OMIM entry page URL by MIM number
 * @param mimNumber - OMIM MIM number
 * @returns OMIM entry URL or null if MIM number missing
 * @note For future use when MIM number is available in schema (Phase 17)
 */
export function buildOmimUrl(mimNumber: string | null): string | null {
  if (mimNumber == null || mimNumber === '') {
    return null
  }

  const encodedMim = encodeURIComponent(mimNumber)
  return `https://omim.org/entry/${encodedMim}`
}

/**
 * Build OMIM gene search URL
 * @param geneSymbol - Gene symbol (e.g., "BRCA1")
 * @returns OMIM search URL or null if gene symbol missing
 * @note Primary OMIM link for Phase 15 (Variant interface has gene_symbol)
 */
export function buildOmimGeneSearchUrl(geneSymbol: string | null): string | null {
  if (geneSymbol == null || geneSymbol === '') {
    return null
  }

  const encodedGene = encodeURIComponent(geneSymbol)
  return `https://omim.org/search?search=${encodedGene}`
}

/**
 * Build UCSC Genome Browser region view URL
 * @param chr - Chromosome
 * @param pos - Genomic position
 * @param build - Genome build
 * @returns UCSC URL or null if required data missing
 */
export function buildUcscUrl(
  chr: string | null,
  pos: number | null,
  build: GenomeBuild
): string | null {
  if (chr == null || chr === '' || pos == null || pos <= 0) {
    return null
  }

  // Select genome database
  const db = build === 'GRCh37' ? 'hg19' : 'hg38'

  // Narrow 50bp window centered on variant position
  const start = Math.max(1, pos - 25) // Clamp to minimum 1
  const end = pos + 25

  // Construct position string: chr:start-end
  const position = `${chr}:${start}-${end}`
  const encodedPosition = encodeURIComponent(position)

  return `https://genome.ucsc.edu/cgi-bin/hgTracks?db=${db}&position=${encodedPosition}`
}

/**
 * Build VarSome variant interpretation URL
 * @param chr - Chromosome
 * @param pos - Genomic position
 * @param ref - Reference allele
 * @param alt - Alternate allele
 * @param build - Genome build
 * @returns VarSome URL or null if required data missing
 */
export function buildVarsomeUrl(
  chr: string | null,
  pos: number | null,
  ref: string | null,
  alt: string | null,
  build: GenomeBuild
): string | null {
  if (
    chr == null ||
    chr === '' ||
    pos == null ||
    pos <= 0 ||
    ref == null ||
    ref === '' ||
    alt == null ||
    alt === ''
  ) {
    return null
  }

  // Select genome build identifier
  const genome = build === 'GRCh37' ? 'hg19' : 'hg38'

  // Encode ref/alt
  const encodedRef = encodeURIComponent(ref)
  const encodedAlt = encodeURIComponent(alt)

  return `https://varsome.com/variant/${genome}/${chr}-${pos}-${encodedRef}-${encodedAlt}`
}

/**
 * Build Franklin variant interpretation URL
 * @param chr - Chromosome
 * @param pos - Genomic position
 * @param ref - Reference allele
 * @param alt - Alternate allele
 * @param build - Genome build
 * @returns Franklin URL or null if required data missing
 * @note URL format has LOW confidence from research; may need adjustment
 */
export function buildFranklinUrl(
  chr: string | null,
  pos: number | null,
  ref: string | null,
  alt: string | null,
  build: GenomeBuild
): string | null {
  if (
    chr == null ||
    chr === '' ||
    pos == null ||
    pos <= 0 ||
    ref == null ||
    ref === '' ||
    alt == null ||
    alt === ''
  ) {
    return null
  }

  // Encode ref/alt
  const encodedRef = encodeURIComponent(ref)
  const encodedAlt = encodeURIComponent(alt)

  // Franklin uses 'chr' prefix and build name directly in path
  return `https://franklin.genoox.com/clinical-db/variant/snp/chr${chr}-${pos}-${encodedRef}-${encodedAlt}/${build}`
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
  mim_number: string | null // OMIM MIM number for direct entry links
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
  const fieldMap: Record<string, string | number | null> = {
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
    const placeholder = `{${key}}`
    // Use regex with global flag for compatibility
    const regex = new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g')
    resolved = resolved.replace(regex, value)
  }

  return resolved
}
