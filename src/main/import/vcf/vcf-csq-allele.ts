/**
 * How a VEP CSQ `Allele` value names one ALT of a multi-allelic record when
 * the CSQ has no ALLELE_NUM (#556).
 */
import type { VcfHeader } from './types'

/**
 * The CSQ `Allele` spellings that may stand for one ALT, plus the ALT itself.
 * Default VEP (Parser/VCF.pm) trims the first base from REF and every ALT only
 * when the site has an indel and all alleles share that base, so each ALT has
 * one spelling (ATT>A,AT → '-','T'). `--minimal` trims each ALT on its own,
 * which can give two ALTs the same spelling; the uniqueness check then fails
 * closed (VEP's --allele_number resolves it).
 */
export function csqAlleleSpellings(
  altAllele: string,
  ref: string,
  allAlts: string[],
  minimal: boolean
): Set<string> {
  const spellings = new Set<string>([altAllele])
  if (minimal) {
    if (altAllele.length < ref.length) spellings.add('-')
    if (altAllele.length > 1) spellings.add(altAllele.substring(1))
    return spellings
  }
  const first = ref.charAt(0)
  const trimmed =
    first !== '' &&
    allAlts.some((alt) => alt.length !== ref.length) &&
    allAlts.every((alt) => alt.charAt(0) === first)
  if (trimmed) spellings.add(altAllele.substring(1) || '-')
  return spellings
}

const VEP_COMMAND_LINE_PREFIX = '##VEP-command-line='
const VEP_MINIMAL_OPTION = /(?:^|[\s'"])--?minimal(?![\w-])/
const vepMinimalByHeader = new WeakMap<VcfHeader, boolean>()

/** Whether VEP ran with `--minimal` (per-ALT allele trimming). */
export function isVepMinimal(header: VcfHeader): boolean {
  let minimal = vepMinimalByHeader.get(header)
  if (minimal === undefined) {
    minimal = header.rawHeaderLines.some(
      (line) => line.startsWith(VEP_COMMAND_LINE_PREFIX) && VEP_MINIMAL_OPTION.test(line)
    )
    vepMinimalByHeader.set(header, minimal)
  }
  return minimal
}

// Sites whose CSQ Allele matched more than one ALT and so annotated none (fail
// closed), counted per import like ../af-out-of-range.ts for the import report.
let ambiguousSites = 0

export function noteAmbiguousCsqSite(): void {
  ambiguousSites++
}

/** Forget what an earlier import counted. */
export function resetAmbiguousCsqSites(): void {
  ambiguousSites = 0
}

/** The count since the last call (undefined when none), and start over. */
export function takeAmbiguousCsqSites(): number | undefined {
  const count = ambiguousSites
  ambiguousSites = 0
  return count === 0 ? undefined : count
}
