/**
 * Gene-panel region arithmetic shared by the SQLite and PostgreSQL backends.
 *
 * A gene panel restricts a variant query to genomic regions: each panel gene's
 * coordinates in the relevant genome build, widened by `panel_padding_bp` on
 * both sides. Both backends must derive the SAME regions from the same panel,
 * so the arithmetic lives here and neither backend re-implements it
 * (issue #447).
 *
 * Matching a variant against a region is an OVERLAP test, written identically
 * in every query builder:
 *
 *   chr = region.chr AND pos <= region.end AND COALESCE(end_pos, pos) >= region.start
 */
import type { GenomicInterval } from '../types/panels'

/** Padding applied around each panel gene when the filter does not carry one. */
export const DEFAULT_PANEL_PADDING_BP = 5000

/** Genome build assumed when neither the filter nor the case names one. */
export const DEFAULT_PANEL_GENOME_BUILD = 'GRCh38'

/** The slice of a gene-reference coordinate row that region building needs. */
export interface PanelGeneCoordinates {
  chromosome: string
  start_pos: number
  end_pos: number
}

/**
 * Sort intervals by chromosome (natural sort) then start position, and merge
 * overlapping or adjacent intervals on the same chromosome.
 */
export function mergeOverlappingIntervals(intervals: GenomicInterval[]): GenomicInterval[] {
  if (intervals.length === 0) return []

  const sorted = [...intervals].sort((a, b) => {
    if (a.chr !== b.chr) return a.chr.localeCompare(b.chr, undefined, { numeric: true })
    return a.start - b.start
  })

  const merged: GenomicInterval[] = [{ ...sorted[0] }]
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1]
    const curr = sorted[i]
    if (curr.chr === last.chr && curr.start <= last.end + 1) {
      last.end = Math.max(last.end, curr.end)
    } else {
      merged.push({ ...curr })
    }
  }
  return merged
}

/**
 * Turn gene coordinates into padded, merged panel regions.
 *
 * @param coordinates Gene coordinates for ONE genome build.
 * @param paddingBp   Bases added on each side of every gene (start clamps at 1).
 * @param chrPrefix   Whether the variant data names chromosomes `chr7` rather
 *                    than `7`; regions are emitted in the same style.
 */
export function buildPaddedPanelIntervals(
  coordinates: Iterable<PanelGeneCoordinates>,
  paddingBp: number,
  chrPrefix: boolean
): GenomicInterval[] {
  const intervals: GenomicInterval[] = []
  for (const coords of coordinates) {
    const chr = chrPrefix
      ? coords.chromosome.startsWith('chr')
        ? coords.chromosome
        : `chr${coords.chromosome}`
      : coords.chromosome
    intervals.push({
      chr,
      start: Math.max(1, coords.start_pos - paddingBp),
      end: coords.end_pos + paddingBp
    })
  }
  return mergeOverlappingIntervals(intervals)
}
