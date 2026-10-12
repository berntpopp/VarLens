/**
 * Interval and genome-build context for CNV/SV calls (#539): which span a call
 * covers, which exons it touches, and whether its build matches the gene model.
 */
import type { GeneExon } from '../../../shared/types/protein'
import { EMPTY_VALUE_PLACEHOLDER } from '../config/displayConfig'

/** rest.ensembl.org serves GRCh38 gene models only, so the gene-structure axis is GRCh38. */
export const GENE_MODEL_ASSEMBLY = 'GRCh38'

export type BuildStatus = 'match' | 'mismatch' | 'unknown'

/** Canonical build name (GRCh37/GRCh38 aliases folded), or null when unknown. */
export function normalizeBuild(build: string | null | undefined): string | null {
  const trimmed = build?.trim() ?? ''
  if (trimmed === '') return null
  const lower = trimmed.toLowerCase()
  if (lower === 'grch38' || lower === 'hg38') return 'GRCh38'
  if (lower === 'grch37' || lower === 'hg19') return 'GRCh37'
  return trimmed
}

export function buildStatus(build: string | null | undefined): BuildStatus {
  const normalized = normalizeBuild(build)
  if (normalized === null) return 'unknown'
  return normalized === GENE_MODEL_ASSEMBLY ? 'match' : 'mismatch'
}

/** What to say about a variant's build next to the GRCh38 gene model; null when it matches. */
export function variantBuildNote(build: string | null | undefined): string | null {
  const status = buildStatus(build)
  if (status === 'match') return null
  if (status === 'unknown') return 'Variant genome build unknown'
  return `Variant is ${normalizeBuild(build)}: not drawn on the ${GENE_MODEL_ASSEMBLY} gene model`
}

export function geneAxisLabel(chromosome: string, note: string | null | undefined): string {
  const axis = `Chromosome ${chromosome} (gene model ${GENE_MODEL_ASSEMBLY})`
  return note === null || note === undefined || note === '' ? axis : `${axis} · ${note}`
}

export interface IntervalSource {
  pos: number
  variant_type?: string | null
  sv_type?: string | null
  end_pos?: number | null
}

export interface VariantInterval {
  start: number
  end: number
}

/**
 * The span a CNV/SV call covers, or null when it is a point: SNVs/indels,
 * breakends (BND: END is not on this axis), insertions and calls without END.
 */
export function variantInterval(v: IntervalSource): VariantInterval | null {
  if (v.variant_type !== 'sv' && v.variant_type !== 'cnv') return null
  if (v.sv_type?.toUpperCase() === 'BND') return null
  const end = v.end_pos
  if (end === null || end === undefined || end <= v.pos) return null
  return { start: v.pos, end }
}

export function exonsInInterval(exons: GeneExon[], interval: VariantInterval): GeneExon[] {
  return exons.filter((e) => e.end >= interval.start && e.start <= interval.end)
}

/** Unsigned base-pair length as bp / kb / Mb; the shared empty glyph when absent. */
export function formatBpLength(length: number | null | undefined): string {
  if (length === null || length === undefined) return EMPTY_VALUE_PLACEHOLDER
  const abs = Math.abs(length)
  // Unsigned: the sign only encodes DEL vs DUP, which the SV type already shows
  if (abs >= 1_000_000) return `${(abs / 1_000_000).toFixed(2)} Mb`
  if (abs >= 1_000) return `${(abs / 1_000).toFixed(2)} kb`
  return `${abs} bp`
}
