/**
 * Key-range chunks for the full rebuild of `cohort_variant_summary` (#469).
 *
 * The rebuild sorts the carrier rows of every variant. As one statement its
 * time grows with the whole cohort and, past the background rebuild's
 * statement timeout, it would fail on every attempt while holding the summary
 * write lock. It therefore runs as one statement per chunk of the genome: a
 * chromosome and a position range. A summary key never spans two chunks, so
 * the union of the chunks is the summary, and each statement only sorts its
 * own rows, which the coordinate index delivers in key order.
 *
 * The chunk width is chosen from the number of variant rows so that a chunk
 * holds about {@link REBUILD_ROWS_PER_CHUNK} of them when variants are spread
 * evenly; dense regions hold more, by a factor bounded by the data's density
 * and not by the size of the cohort.
 */
import type { PoolClient } from 'pg'

type QueryClient = Pick<PoolClient, 'query'>
type Tbl = (table: string) => string

/** Variant rows a rebuild statement should sort, on average. */
export const REBUILD_ROWS_PER_CHUNK = 500_000

export interface ChromosomeRange {
  chr: string
  minPos: number
  maxPos: number
}

export interface RebuildChunk {
  chr: string
  /** Inclusive. */
  fromPos: number
  /** Exclusive. */
  toPos: number
}

/** Split the chromosome ranges so that `totalRows` spread evenly gives `rowsPerChunk` per chunk. */
export function planRebuildChunks(
  ranges: ChromosomeRange[],
  totalRows: number,
  rowsPerChunk = REBUILD_ROWS_PER_CHUNK
): RebuildChunk[] {
  const span = ranges.reduce((sum, range) => sum + (range.maxPos - range.minPos + 1), 0)
  const wanted = Math.max(1, Math.ceil(totalRows / Math.max(1, rowsPerChunk)))
  const width = Math.max(1, Math.ceil(span / wanted))
  const chunks: RebuildChunk[] = []
  for (const range of ranges) {
    for (let from = range.minPos; from <= range.maxPos; from += width) {
      chunks.push({
        chr: range.chr,
        fromPos: from,
        toPos: Math.min(from + width, range.maxPos + 1)
      })
    }
  }
  return chunks
}

/**
 * The chromosomes present and their position range, by probing the coordinate
 * index once per chromosome (a skip scan), not by scanning the variants.
 */
export async function readChromosomeRanges(
  client: QueryClient,
  tbl: Tbl
): Promise<ChromosomeRange[]> {
  const variants = tbl('variants_all')
  const result = await client.query<{ chr: string; min_pos: string; max_pos: string }>(
    `WITH RECURSIVE chromosomes AS (
       (SELECT chr FROM ${variants} ORDER BY chr LIMIT 1)
       UNION ALL
       SELECT (SELECT v.chr FROM ${variants} v WHERE v.chr > c.chr ORDER BY v.chr LIMIT 1)
       FROM chromosomes c
       WHERE c.chr IS NOT NULL
     )
     SELECT c.chr,
            (SELECT MIN(v.pos) FROM ${variants} v WHERE v.chr = c.chr) AS min_pos,
            (SELECT MAX(v.pos) FROM ${variants} v WHERE v.chr = c.chr) AS max_pos
     FROM chromosomes c
     WHERE c.chr IS NOT NULL`
  )
  return result.rows.map((row) => ({
    chr: row.chr,
    minPos: Number(row.min_pos),
    maxPos: Number(row.max_pos)
  }))
}

/**
 * About how many variant rows there are, without scanning them: the per-case
 * counters or the planner's estimate for the table, whichever is larger (a
 * counter can be missing on old cases, the estimate before the first ANALYZE).
 */
export async function countVisibleVariantRows(client: QueryClient, tbl: Tbl): Promise<number> {
  const result = await client.query<{ total: string }>(
    `SELECT GREATEST(
              (SELECT COALESCE(SUM(variant_count), 0) FROM ${tbl('cases')}),
              (SELECT COALESCE(MAX(reltuples), 0) FROM pg_class
                WHERE oid = '${tbl('variants_all')}'::regclass)
            )::bigint AS total`
  )
  return Number(result.rows[0]?.total ?? 0)
}
