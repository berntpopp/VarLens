/**
 * Sorted per-chromosome gene spans of the bundled `gene_reference.db`, one
 * index per (file, build). Shared by the import gene fallback and the CNV
 * phenotype score (CNV/STR spec §4.5). `node:sqlite`, so the same code runs in
 * the Electron and web (no native addon) workers.
 */
import { DatabaseSync } from 'node:sqlite'
import type { GeneSpan, GeneSpanLookup } from '../../../shared/phenotype/cnv-score'

export interface GeneIntervals extends GeneSpanLookup {
  /** Upper-cased HGNC symbol and HGNC id (`HGNC:n`) → approved symbol. */
  symbols: Map<string, string>
}

const indexCache = new Map<string, GeneIntervals>()

/** Chromosome key of `gene_coordinates`: no `chr`, upper case, M → MT. */
function chrKey(chr: string): string {
  const key = chr.replace(/^chr/i, '').toUpperCase()
  return key === 'M' ? 'MT' : key
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

function load(path: string, build: string): GeneIntervals {
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
        `SELECT c.chromosome, c.start_pos, c.end_pos, g.symbol, g.hgnc_id, g.locus_group
         FROM gene_coordinates c JOIN genes g ON g.hgnc_id = c.hgnc_id
         WHERE c.assembly = ? ORDER BY c.start_pos`
      )
      .all(build) as Array<{
      chromosome: string
      start_pos: number
      end_pos: number
      symbol: string
      hgnc_id: string
      locus_group: string | null
    }>
    const spans = new Map<string, GeneSpan[]>()
    /** approved symbol → its spans (one per chromosome, e.g. PAR genes on X and Y) */
    const bySymbol = new Map<string, GeneSpan[]>()
    let maxSpan = 0
    for (const r of rows) {
      const span: GeneSpan = {
        chr: r.chromosome,
        start: r.start_pos,
        end: r.end_pos,
        symbol: r.symbol,
        hgncId: r.hgnc_id,
        coding: r.locus_group === 'protein-coding gene'
      }
      const list = spans.get(r.chromosome) ?? []
      list.push(span)
      spans.set(r.chromosome, list)
      const same = bySymbol.get(r.symbol) ?? []
      same.push(span)
      bySymbol.set(r.symbol, same)
      maxSpan = Math.max(maxSpan, r.end_pos - r.start_pos)
    }
    return {
      symbols,
      overlapping(chr, a, b) {
        const list = spans.get(chrKey(chr))
        if (list === undefined) return []
        const out: GeneSpan[] = []
        for (let i = lowerBound(list, a - maxSpan); i < list.length; i++) {
          const span = list[i]
          if (span.start > b) break
          if (span.end >= a) out.push(span)
        }
        return out
      },
      span(symbol, chr) {
        const approved = symbols.get(symbol) ?? symbols.get(symbol.toUpperCase())
        const key = chrKey(chr)
        return approved === undefined
          ? undefined
          : bySymbol.get(approved)?.find((s) => s.chr === key)
      }
    }
  } finally {
    db.close()
  }
}

/** The (cached) gene-interval index of one build. */
export function loadGeneIntervals(path: string, build: string): GeneIntervals {
  const key = `${path}\0${build}`
  let index = indexCache.get(key)
  if (index === undefined) {
    index = load(path, build)
    indexCache.set(key, index)
  }
  return index
}
