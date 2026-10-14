/**
 * Gene fallback for SV / CNV / STR rows that arrive without a gene annotation.
 *
 * Callers such as Stranger, ExpansionHunter, Sniffles or Spectre emit no
 * CSQ/ANN gene, so those rows used to import with `gene_symbol` NULL. The
 * bundled `gene_reference.db` (HGNC symbols + per-build gene coordinates)
 * resolves them at import, in both import workers:
 *
 *   STR:      REPID → VARID → HGNCId (as an HGNC symbol / id) → locus overlap
 *   SV / CNV: gene overlap of POS..END
 *
 * Overlap picks a protein-coding gene before any other locus group, then the
 * one starting first. An annotated gene is never replaced. Uses `node:sqlite`
 * so the same code runs in the Electron and web (no native addon) workers.
 */
import { existsSync } from 'node:fs'
import { loadGeneIntervals, type GeneIntervals } from '../../services/reference/gene-intervals'
import type { VcfMappedVariant } from './types'

export type GeneFiller = (variant: VcfMappedVariant) => void

const FILLED_TYPES = new Set(['sv', 'cnv', 'str'])

/** The first protein-coding gene overlapping [start, end], else the first gene. */
function overlappingGene(
  index: GeneIntervals,
  chr: string,
  start: number,
  end: number
): string | null {
  const spans = index.overlapping(chr, start, end)
  return (spans.find((s) => s.coding) ?? spans[0])?.symbol ?? null
}

function strLocusGene(index: GeneIntervals, variant: VcfMappedVariant): string | null {
  const lookup = (id: string | null | undefined): string | null => {
    if (id == null || id === '') return null
    // Stranger suffixes a gene's further loci (`HOXA13_1`, `ARX_2`).
    return (
      index.symbols.get(id.toUpperCase()) ??
      index.symbols.get(id.replace(/_\d+$/, '').toUpperCase()) ??
      null
    )
  }
  return (
    lookup(variant._str?.repeat_id) ??
    lookup(variant._str?.variant_catalog_id) ??
    lookup(hgncIdFromInfo(variant.info_json))
  )
}

function hgncIdFromInfo(infoJson: string | null): string | null {
  if (infoJson === null) return null
  const raw = (JSON.parse(infoJson) as Record<string, unknown>).HGNCId
  if (typeof raw !== 'string' && typeof raw !== 'number') return null
  const id = String(raw)
  return id.startsWith('HGNC:') ? id : `HGNC:${id}`
}

/**
 * A filler for one import file. A no-op when the gene reference is missing;
 * the reference is only read once a row actually needs a gene.
 */
export function createGeneFiller(
  geneRefDbPath: string | undefined,
  genomeBuild: string
): GeneFiller {
  if (geneRefDbPath === undefined || !existsSync(geneRefDbPath)) return () => undefined
  return (variant) => {
    if (variant.gene_symbol != null && variant.gene_symbol !== '') return
    if (!FILLED_TYPES.has(variant.variant_type)) return
    const index = loadGeneIntervals(geneRefDbPath, genomeBuild)
    variant.gene_symbol =
      (variant.variant_type === 'str' ? strLocusGene(index, variant) : null) ??
      overlappingGene(index, variant.chr, variant.pos, variant.end_pos ?? variant.pos)
  }
}
