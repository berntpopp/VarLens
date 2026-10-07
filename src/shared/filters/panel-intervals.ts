/**
 * Gene-panel region arithmetic shared by the SQLite and PostgreSQL backends.
 *
 * A gene panel restricts a variant query to genomic regions: each panel gene's
 * coordinates in the relevant genome build, widened by `panel_padding_bp` on
 * both sides. Both backends must derive the SAME regions from the same panel,
 * so the arithmetic lives here and neither backend re-implements it
 * (issue #447).
 *
 * Resolution contract — the single definition, enforced for both backends by
 * {@link resolvePanelGeneRegions}:
 * - The active panel(s) contain NO genes → no regions, and the query runs
 *   without a panel restriction (there is nothing to restrict on).
 * - The active panel(s) contain genes but NONE has coordinates in the genome
 *   build being queried → {@link PanelRegionsUnavailableError}. Returning "no
 *   regions" here would show every variant while the user believes a panel is
 *   active.
 * - Some genes have coordinates → their regions; genes without coordinates in
 *   that build are left out of the restriction. The query still runs, so the
 *   left-out genes are reported separately by {@link resolvePanelGeneStatus}
 *   (`panels:resolutionStatus`) and shown to the user as a warning.
 *
 * Matching a variant against a region is an OVERLAP test, written identically
 * in every query builder:
 *
 *   chr = region.chr AND pos <= region.end AND COALESCE(end_pos, pos) >= region.start
 */
import { ErrorCode } from '../types/errors'
import type { GenomicInterval, PanelResolutionStatus } from '../types/panels'

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

/**
 * A gene panel is active and has genes, but none of them has coordinates in
 * the genome build being queried, so the panel cannot restrict anything.
 *
 * Carries its own envelope `code` / `userMessage` so the IPC and web error
 * mappers report it to the user verbatim instead of as an unexpected failure.
 */
export class PanelRegionsUnavailableError extends Error {
  readonly code = ErrorCode.VALIDATION
  readonly userMessage: string

  constructor(
    readonly geneCount: number,
    readonly genomeBuild: string
  ) {
    super(
      `Active gene panel resolves to no genomic regions: none of its ${geneCount} gene(s) has coordinates for genome build ${genomeBuild}`
    )
    this.name = 'PanelRegionsUnavailableError'
    this.userMessage = `The active gene panel cannot be applied: none of its ${geneCount} gene(s) has coordinates for genome build ${genomeBuild}. Deactivate the panel or use one that covers this build.`
  }
}

/** Looks up gene coordinates for ONE genome build, keyed by HGNC id. */
export type PanelGeneCoordinateLookup = (
  hgncIds: string[],
  genomeBuild: string
) => ReadonlyMap<string, PanelGeneCoordinates>

/**
 * Resolve the genes of the active panel(s) into padded, merged regions.
 * Implements the resolution contract in the module comment; both backends
 * call it so they cannot disagree.
 *
 * @param hgncIds Distinct HGNC ids of every gene in the active panel(s).
 * @throws {PanelRegionsUnavailableError} when there are genes but no regions.
 */
export function resolvePanelGeneRegions(
  hgncIds: readonly string[],
  genomeBuild: string,
  paddingBp: number,
  chrPrefix: boolean,
  getCoordinates: PanelGeneCoordinateLookup
): GenomicInterval[] {
  if (hgncIds.length === 0) return []
  const coordinates = getCoordinates([...hgncIds], genomeBuild)
  const intervals = buildPaddedPanelIntervals(coordinates.values(), paddingBp, chrPrefix)
  if (intervals.length === 0) throw new PanelRegionsUnavailableError(hgncIds.length, genomeBuild)
  return intervals
}

/**
 * The genome build a resolution-status request refers to: the explicitly
 * selected build (cohort view), else the build of the case (case view), else
 * the default — the same order the variant and cohort queries use.
 */
export function panelStatusGenomeBuild(
  requestedBuild: string | null | undefined,
  caseBuild: string | null | undefined
): string {
  if (requestedBuild != null && requestedBuild !== '') return requestedBuild
  if (caseBuild != null && caseBuild !== '') return caseBuild
  return DEFAULT_PANEL_GENOME_BUILD
}

/** The slice of a `panel_genes` row that the resolution status needs. */
export interface PanelGeneIdentity {
  hgnc_id: string
  symbol: string
}

/** Code-unit ordering: identical on every backend, platform and locale. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Report which genes of the active panel(s) have no coordinates in
 * `genomeBuild` — the genes {@link resolvePanelGeneRegions} leaves out. Uses
 * the same coordinate lookup, so "unmapped" here is exactly "not restricted
 * on" there. Never throws for unmapped genes: a fully unmapped panel is
 * reported as `unmappedCount === totalGenes`.
 *
 * @param genes Every gene row of the active panel(s); a gene that is in
 *              several panels is counted once.
 */
export function resolvePanelGeneStatus(
  genes: readonly PanelGeneIdentity[],
  genomeBuild: string,
  getCoordinates: PanelGeneCoordinateLookup
): PanelResolutionStatus {
  const symbolByHgncId = new Map<string, string>()
  for (const gene of genes) {
    const known = symbolByHgncId.get(gene.hgnc_id)
    if (known === undefined || compareText(gene.symbol, known) < 0) {
      symbolByHgncId.set(gene.hgnc_id, gene.symbol)
    }
  }
  const hgncIds = [...symbolByHgncId.keys()]
  const mapped = hgncIds.length === 0 ? new Map() : getCoordinates(hgncIds, genomeBuild)
  const unmappedGenes = hgncIds
    .filter((hgncId) => !mapped.has(hgncId))
    .map((hgncId) => ({ hgncId, symbol: symbolByHgncId.get(hgncId) as string }))
    .sort((a, b) => compareText(a.symbol, b.symbol) || compareText(a.hgncId, b.hgncId))
  return {
    genomeBuild,
    totalGenes: hgncIds.length,
    unmappedCount: unmappedGenes.length,
    unmappedGenes
  }
}
