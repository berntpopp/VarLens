/**
 * VEP CSQ `CLIN_SIG` as a fallback source for the `clinvar` column.
 *
 * `CLIN_SIG` is VEP's "ClinVar clinical significance of the dbSNP variant"
 * (co-located known variant), not a dedicated ClinVar annotation like the
 * `ClinVar_CLNSIG` custom field or INFO `CLNSIG`. It is only trustworthy for
 * one ALT allele when VEP reported it allele-specifically:
 *
 * - `--clin_sig_allele` exists and defaults to 1 since ensembl-vep release 98
 *   (Config.pm). Earlier releases report every significance at the locus.
 * - `--clin_sig_allele 0` restores the locus-wide behaviour.
 * - `--no_check_alleles` matches co-located variants by coordinate only.
 * - A cache older than release 98 carries no per-allele significance, in which
 *   case VEP silently falls back to the locus-wide value (OutputFactory.pm).
 *
 * The importer reads those facts from the `##VEP=` and `##VEP-command-line=`
 * header lines and refuses the fallback whenever they cannot be established.
 */
import type { VcfHeader } from './types'

/** First ensembl-vep release whose default output is allele-specific. */
const MIN_ALLELE_SPECIFIC_VEP_RELEASE = 98

const VEP_LINE_PREFIX = '##VEP='
const VEP_COMMAND_LINE_PREFIX = '##VEP-command-line='
const VEP_RELEASE_PATTERN = /^##VEP="v(\d+)/
const VEP_CACHE_RELEASE_PATTERN = /\scache="[^"]*[/\\](\d+)_[^"/\\]*"/
const LOCUS_WIDE_OPTION_PATTERN =
  /(?:^|[\s'])--?(?:clin_sig_allele[\s=]+0(?![\d.])|no_check_alleles)/

/**
 * ClinVar spells these modifiers in lower case inside CLNSIG; everything else
 * (the germline classification terms) starts with a capital letter.
 */
const LOWER_CASE_CLNSIG_TERMS = new Set([
  'affects',
  'association',
  'association_not_found',
  'confers_sensitivity',
  'drug_response',
  'low_penetrance',
  'not_provided',
  'other',
  'protective',
  'risk_factor'
])

const alleleSpecificByHeader = new WeakMap<VcfHeader, boolean>()

/** Whether this file's CSQ `CLIN_SIG` is provably allele-specific. */
export function isVepClinSigAlleleSpecific(header: VcfHeader): boolean {
  const cached = alleleSpecificByHeader.get(header)
  if (cached !== undefined) return cached
  const result = detectAlleleSpecificClinSig(header)
  alleleSpecificByHeader.set(header, result)
  return result
}

function detectAlleleSpecificClinSig(header: VcfHeader): boolean {
  if (header.annotationType !== 'csq' || header.csqFields === null) return false
  if (!header.csqFields.includes('CLIN_SIG')) return false

  const vepLine = header.rawHeaderLines.find((line) => line.startsWith(VEP_LINE_PREFIX))
  if (vepLine === undefined) return false
  const release = VEP_RELEASE_PATTERN.exec(vepLine)
  if (release === null || Number(release[1]) < MIN_ALLELE_SPECIFIC_VEP_RELEASE) return false

  const cacheRelease = VEP_CACHE_RELEASE_PATTERN.exec(vepLine)
  if (cacheRelease !== null && Number(cacheRelease[1]) < MIN_ALLELE_SPECIFIC_VEP_RELEASE) {
    return false
  }

  return !header.rawHeaderLines.some(
    (line) => line.startsWith(VEP_COMMAND_LINE_PREFIX) && LOCUS_WIDE_OPTION_PATTERN.test(line)
  )
}

/**
 * Convert VEP's spelling (`benign&benign/likely_benign`) to the ClinVar
 * CLNSIG spelling the rest of VarLens stores and filters on
 * (`Benign|Benign/Likely_benign`).
 */
export function normalizeVepClinSig(raw: string | undefined): string | null {
  if (raw === undefined || raw === '') return null
  const terms = new Set<string>()
  for (const value of raw.split(/[&;,]/)) {
    const term = value.trim()
    if (term === '' || term === '.') continue
    terms.add(term.split('/').map(toClnsigSpelling).join('/'))
  }
  return terms.size === 0 ? null : Array.from(terms).join('|')
}

function toClnsigSpelling(term: string): string {
  if (term === '' || LOWER_CASE_CLNSIG_TERMS.has(term.toLowerCase())) return term.toLowerCase()
  return term.charAt(0).toUpperCase() + term.slice(1)
}
