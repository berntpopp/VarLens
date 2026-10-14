/**
 * Sorted per-chromosome gene spans of the bundled `gene_reference.db`, one
 * index per (file, build), rebuilt when the file changes (in-app reference
 * update). Shared by the import gene fallback and the CNV phenotype score
 * (CNV/STR spec §4.5). `node:sqlite`, so the same code runs in the Electron and
 * web (no native addon) workers.
 */
import { statSync } from 'node:fs'
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

/** First index whose start is at or after `pos`. */
function lowerBound(starts: Float64Array, pos: number): number {
  let lo = 0
  let hi = starts.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (starts[mid] < pos) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Spans of one chromosome ordered by start; `starts` mirrors them for the binary search. */
interface Chromosome {
  spans: GeneSpan[]
  starts: Float64Array
  maxSpan: number
  /** approved symbol and HGNC id → its span on this chromosome */
  bySymbol: Map<string, GeneSpan>
}

type GeneRow = [hgncId: string, symbol: string, coding: number]
type CoordRow = [chromosome: string, start: number, end: number, hgncId: string]

function rows<T>(db: DatabaseSync, sql: string, ...params: string[]): T[] {
  const statement = db.prepare(sql)
  statement.setReturnArrays(true) // ~2× faster than row objects over 40k rows (CNV-6 load budget)
  return statement.all(...params) as T[]
}

/** One chromosome's spans; `genes` maps HGNC id → [symbol, coding]. */
function chromosome(coords: readonly CoordRow[], genes: Map<string, GeneRow>): Chromosome {
  const spans: GeneSpan[] = []
  const bySymbol = new Map<string, GeneSpan>()
  for (const [chr, start, end, hgncId] of coords) {
    const gene = genes.get(hgncId)
    if (gene === undefined) continue
    const span: GeneSpan = { chr, start, end, symbol: gene[1], hgncId, coding: gene[2] === 1 }
    spans.push(span)
    bySymbol.set(gene[1], span).set(hgncId, span)
  }
  spans.sort((x, y) => x.start - y.start)
  const starts = Float64Array.from(spans, (s) => s.start)
  const maxSpan = spans.reduce((m, s) => Math.max(m, s.end - s.start), 0)
  return { spans, starts, maxSpan, bySymbol }
}

function load(path: string, build: string): GeneIntervals {
  const db = new DatabaseSync(path, { readOnly: true })
  let genes: GeneRow[]
  let coords: CoordRow[]
  try {
    // Two plain scans joined in JS: the SQL join costs ~40 ms in per-row index lookups.
    genes = rows(db, "SELECT hgnc_id, symbol, locus_group = 'protein-coding gene' FROM genes")
    coords = rows(
      db,
      'SELECT chromosome, start_pos, end_pos, hgnc_id FROM gene_coordinates WHERE assembly = ?',
      build
    )
  } finally {
    db.close()
  }
  const byHgnc = new Map<string, GeneRow>()
  for (const gene of genes) byHgnc.set(gene[0], gene)
  // Built on first use: the import fallback and case-insensitive span lookups need it, CNV overlap does not.
  let symbols: Map<string, string> | undefined
  const allSymbols = (): Map<string, string> => {
    if (symbols === undefined) {
      symbols = new Map()
      for (const [hgncId, symbol] of genes)
        symbols.set(symbol.toUpperCase(), symbol).set(hgncId, symbol)
    }
    return symbols
  }
  const coordsByChr = new Map<string, CoordRow[]>()
  for (const row of coords) {
    const list = coordsByChr.get(row[0])
    if (list === undefined) coordsByChr.set(row[0], [row])
    else list.push(row)
  }
  // Spans are built per chromosome on first use: a case touches few, the load stays under budget.
  const built = new Map<string, Chromosome | undefined>()
  const get = (chr: string): Chromosome | undefined => {
    const key = chrKey(chr)
    if (!built.has(key)) {
      const list = coordsByChr.get(key)
      built.set(key, list === undefined ? undefined : chromosome(list, byHgnc))
    }
    return built.get(key)
  }
  return {
    get symbols() {
      return allSymbols()
    },
    overlapping(chr, a, b) {
      const c = get(chr)
      if (c === undefined) return []
      const out: GeneSpan[] = []
      for (let i = lowerBound(c.starts, a - c.maxSpan); i < c.spans.length; i++) {
        const span = c.spans[i]
        if (span.start > b) break
        if (span.end >= a) out.push(span)
      }
      return out
    },
    span(symbol, chr) {
      const c = get(chr)
      const hit = c?.bySymbol.get(symbol)
      if (c === undefined || hit !== undefined) return hit
      const approved = allSymbols().get(symbol.toUpperCase())
      return approved === undefined ? undefined : c.bySymbol.get(approved)
    }
  }
}

/** The gene-interval index of one build, cached until the file's mtime or size changes. */
export function loadGeneIntervals(path: string, build: string): GeneIntervals {
  const stat = statSync(path)
  const key = `${path}\0${build}\0${stat.mtimeMs}\0${stat.size}`
  let index = indexCache.get(key)
  if (index === undefined) {
    for (const old of indexCache.keys())
      if (old.startsWith(`${path}\0${build}\0`)) indexCache.delete(old)
    index = load(path, build)
    indexCache.set(key, index)
  }
  return index
}
