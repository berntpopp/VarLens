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
import { DatabaseSync } from 'node:sqlite'
import type { VcfMappedVariant } from './types'

interface GeneSpan {
  start: number
  end: number
  symbol: string
  coding: boolean
}

interface GeneIndex {
  /** Upper-cased HGNC symbol and HGNC id (`HGNC:n`) → approved symbol. */
  symbols: Map<string, string>
  /** Chromosome (no `chr`) → spans sorted by start. */
  spans: Map<string, GeneSpan[]>
  /** Longest gene span of the build: bounds the overlap scan. */
  maxSpan: number
}

export type GeneFiller = (variant: VcfMappedVariant) => void

const FILLED_TYPES = new Set(['sv', 'cnv', 'str'])
const indexCache = new Map<string, GeneIndex>()

function loadIndex(path: string, build: string): GeneIndex {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    const symbols = new Map<string, string>()
    const genes = db.prepare('SELECT hgnc_id, symbol FROM genes').all() as Array<{
      hgnc_id: string
      symbol: string
    }>
    for (const g of genes) {
      symbols.set(g.symbol.toUpperCase(), g.symbol)
      symbols.set(g.hgnc_id, g.symbol)
    }
    const rows = db
      .prepare(
        `SELECT c.chromosome, c.start_pos, c.end_pos, g.symbol, g.locus_group
         FROM gene_coordinates c JOIN genes g ON g.hgnc_id = c.hgnc_id
         WHERE c.assembly = ? ORDER BY c.start_pos`
      )
      .all(build) as Array<{
      chromosome: string
      start_pos: number
      end_pos: number
      symbol: string
      locus_group: string | null
    }>
    const spans = new Map<string, GeneSpan[]>()
    let maxSpan = 0
    for (const r of rows) {
      const list = spans.get(r.chromosome) ?? []
      list.push({
        start: r.start_pos,
        end: r.end_pos,
        symbol: r.symbol,
        coding: r.locus_group === 'protein-coding gene'
      })
      spans.set(r.chromosome, list)
      maxSpan = Math.max(maxSpan, r.end_pos - r.start_pos)
    }
    return { symbols, spans, maxSpan }
  } finally {
    db.close()
  }
}

/** First index whose span starts at or after `pos`. */
function lowerBound(spans: GeneSpan[], pos: number): number {
  let lo = 0
  let hi = spans.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (spans[mid].start < pos) lo = mid + 1
    else hi = mid
  }
  return lo
}

function overlappingGene(index: GeneIndex, chr: string, start: number, end: number): string | null {
  const key = chr.replace(/^chr/i, '').toUpperCase()
  const spans = index.spans.get(key === 'M' ? 'MT' : key)
  if (spans === undefined) return null
  let fallback: string | null = null
  for (let i = lowerBound(spans, start - index.maxSpan); i < spans.length; i++) {
    const span = spans[i]
    if (span.start > end) break
    if (span.end < start) continue
    if (span.coding) return span.symbol
    fallback ??= span.symbol
  }
  return fallback
}

function strLocusGene(index: GeneIndex, variant: VcfMappedVariant): string | null {
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
  const cacheKey = `${geneRefDbPath}\0${genomeBuild}`
  return (variant) => {
    if (variant.gene_symbol != null && variant.gene_symbol !== '') return
    if (!FILLED_TYPES.has(variant.variant_type)) return
    let index = indexCache.get(cacheKey)
    if (index === undefined) {
      index = loadIndex(geneRefDbPath, genomeBuild)
      indexCache.set(cacheKey, index)
    }
    variant.gene_symbol =
      (variant.variant_type === 'str' ? strLocusGene(index, variant) : null) ??
      overlappingGene(index, variant.chr, variant.pos, variant.end_pos ?? variant.pos)
  }
}
