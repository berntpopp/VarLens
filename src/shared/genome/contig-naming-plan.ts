/**
 * What the chromosome-naming migration does to one stored case
 * (spec: .planning/specs/2026-10-12-chr-naming-per-build.md). Pure; both
 * backends call it.
 *
 * A case already in its build's form needs nothing. Otherwise the stored
 * build is re-checked first: older batch/JSON imports defaulted to GRCh38, and
 * renaming a mislabelled case would invent wrong names. Only a build the
 * evidence confirms is renamed; anything else is flagged for the user.
 */
import { canonicalContig, isCanonicalContig } from '../utils/contig'
import { detectGenomeBuild, detectionBuild } from './genome-build'

export interface ContigRename {
  from: string
  to: string
}

/** Why a case waits for the user to confirm its build. */
export type BuildReviewReason = 'no_evidence' | 'build_disagrees' | 'build_excluded'

export type ContigNamingPlan =
  | { action: 'none' }
  | { action: 'rename'; pairs: ContigRename[] }
  | { action: 'flag'; suggestedBuild: string | null; reason: BuildReviewReason }

/** The stored names of a case that differ from `build`'s form, with their new names. */
export function contigRenamePairs(chrs: readonly string[], build: string): ContigRename[] {
  return chrs
    .filter((chr) => !isCanonicalContig(chr, build))
    .map((chr) => ({ from: chr, to: canonicalContig(chr, build) }))
}

/**
 * Re-check a stored case's build. VarLens stores no VCF header, so the caller
 * supplies the header re-read from the case's source file when it still
 * exists, and the stored max POS per chromosome (which can only exclude a build).
 */
export function redetectStoredCaseBuild(input: {
  genomeBuild: string
  headerLines: readonly string[]
  maxPos?: Readonly<Record<string, number>>
}): { detected: string | null; storedExcluded: boolean } {
  const detection = detectGenomeBuild(input.headerLines, input.maxPos)
  return {
    detected: detectionBuild(detection),
    storedExcluded: detection.excluded.some((e) => e.build === input.genomeBuild)
  }
}

export function planCaseContigNaming(input: {
  genomeBuild: string
  contigs: ReadonlyArray<{ chr: string; maxPos: number }>
  headerLines: readonly string[]
}): ContigNamingPlan {
  const pairs = contigRenamePairs(
    input.contigs.map((c) => c.chr),
    input.genomeBuild
  )
  if (pairs.length === 0) return { action: 'none' }
  const { detected, storedExcluded } = redetectStoredCaseBuild({
    genomeBuild: input.genomeBuild,
    headerLines: input.headerLines,
    maxPos: Object.fromEntries(input.contigs.map((c) => [c.chr, c.maxPos]))
  })
  if (detected !== null && detected !== input.genomeBuild) {
    return { action: 'flag', suggestedBuild: detected, reason: 'build_disagrees' }
  }
  if (storedExcluded) return { action: 'flag', suggestedBuild: null, reason: 'build_excluded' }
  if (detected === null) return { action: 'flag', suggestedBuild: null, reason: 'no_evidence' }
  return { action: 'rename', pairs }
}
