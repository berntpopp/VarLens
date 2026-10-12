/**
 * Chromosome names (spec: .planning/specs/2026-10-12-chr-naming-per-build.md).
 *
 * Stored form: the build's reference-dictionary name for the 25 primary
 * contigs (GRCh38 `chr1`/`chrM`, GRCh37 `1`/`MT`), read from
 * genome-builds.config.ts; every other contig verbatim. Worker-safe: no
 * imports beyond shared config.
 * ponytail: alt/decoy/unplaced and NC_ accessions stay verbatim; upgrade to the
 * NCBI assembly-report alias table if a lab imports them.
 */
import { GENOME_BUILDS, IMPORTABLE_GENOME_BUILDS } from '../config/genome-builds.config'
import { normalizeContigName } from '../sql/chromosome-order'

const PRIMARY: ReadonlySet<string> = new Set([
  ...Array.from({ length: 22 }, (_, i) => String(i + 1)),
  'X',
  'Y'
])
const MITO_NAMES: ReadonlySet<string> = new Set(['M', 'MT'])

/** The name `chr` is stored under in a case of `build`; unknown builds and other contigs: verbatim. */
export function canonicalContig(chr: string, build: string): string {
  const naming = GENOME_BUILDS.find((b) => b.id === build)?.naming
  if (naming === undefined) return chr
  const n = normalizeContigName(chr.trim())
  if (PRIMARY.has(n)) return `${naming.primaryPrefix}${n}`
  if ((naming.mitoAliases as readonly string[]).includes(n)) return naming.mito
  return chr
}

export function isCanonicalContig(chr: string, build: string): boolean {
  return canonicalContig(chr, build) === chr
}

/**
 * Ensembl/GRC form for APIs and links (VEP, SpliceAI, MyVariant, gnomAD, ClinVar).
 * ponytail: hg19 `chrM` maps to rCRS `MT` here; pass the build if mito lookups matter.
 */
export function bareContig(chr: string): string {
  const trimmed = chr.trim()
  const n = normalizeContigName(trimmed)
  if (PRIMARY.has(n)) return n
  if (MITO_NAMES.has(n)) return 'MT'
  return trimmed.replace(/^chr/i, '')
}

/** Every stored name a user-typed contig can mean, across importable builds (query input). */
export function contigQueryNames(chr: string): string[] {
  const input = chr.trim()
  const n = normalizeContigName(input)
  const mito = MITO_NAMES.has(n)
  // Any other contig is stored verbatim, so the typed name is the only one.
  const names = new Set(PRIMARY.has(n) || mito ? [] : [input])
  for (const build of IMPORTABLE_GENOME_BUILDS) {
    names.add(canonicalContig(input, build.id))
    if (mito) names.add(build.naming.mito)
  }
  if (mito) names.add('chrM') // hg19's own mitochondrion, stored verbatim
  return [...names]
}

/**
 * The regions of a panel/region/BED filter, once per stored spelling of each
 * region's contig (query side). A case flagged for build review keeps its
 * non-canonical names until it is confirmed, and must still match; equality on
 * `chr` stays index-friendly. Builds are restricted separately.
 */
export function intervalsForAllSpellings<T extends { chr: string }>(intervals: readonly T[]): T[] {
  return intervals.flatMap((iv) =>
    contigQueryNames(iv.chr).map((chr) => (chr === iv.chr ? iv : { ...iv, chr }))
  )
}
