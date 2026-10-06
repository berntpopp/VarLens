/**
 * Natural chromosome ordering shared by SQLite (desktop) and PostgreSQL (web).
 *
 * Order: 1..22, X, Y, MT (M and MT are the same contig), then every other
 * contig (unplaced, alt, decoy, …) with one shared rank. Callers break ties
 * alphabetically by `chr`, so the other contigs sort by name after MT.
 *
 * The `chr` prefix is ignored, whatever its case (`chr1`, `Chr1`, `1` → 1).
 * Matching is case-insensitive (`x` → X, `chrM` → MT).
 *
 * `chrRankSql()` is the single source of the SQL expression. It uses only
 * functions with the same meaning in SQLite and PostgreSQL (`substr`, `lower`,
 * `upper`, simple `CASE`). Both backends use expression indexes on this exact
 * expression, so the query side must emit it through this function and never
 * hand-write it:
 *   - SQLite: `idx_variants_case_chr_rank`, `idx_cvs_chr_rank`, `idx_cvs_carrier_chr_rank`
 *     (migration v33, `sqlite-chr-rank-migration.ts`)
 *   - PostgreSQL: the same three names (migration `0017_chr_rank_indexes.sql`)
 * Changing the expression means a new migration on both backends that rebuilds
 * those indexes; otherwise ORDER BY no longer matches them and falls back to a sort.
 */

/** Rank shared by every contig that is not 1..22, X, Y or MT. */
export const OTHER_CONTIG_RANK = 100

const NAMED_CONTIG_RANKS: ReadonlyArray<readonly [string, number]> = [
  ...Array.from({ length: 22 }, (_, i) => [String(i + 1), i + 1] as const),
  ['X', 23],
  ['Y', 24],
  ['M', 25],
  ['MT', 25]
]

const RANK_BY_NAME: ReadonlyMap<string, number> = new Map(NAMED_CONTIG_RANKS)

/** Strip a case-insensitive `chr` prefix and upper-case the remainder. */
export function normalizeContigName(chr: string): string {
  const bare = chr.slice(0, 3).toLowerCase() === 'chr' ? chr.slice(3) : chr
  return bare.toUpperCase()
}

/** Natural rank of a chromosome name; JS mirror of `chrRankSql()`. */
export function chromosomeRank(chr: string | null | undefined): number {
  if (chr === null || chr === undefined) return OTHER_CONTIG_RANK
  return RANK_BY_NAME.get(normalizeContigName(chr)) ?? OTHER_CONTIG_RANK
}

/** Comparator for natural chromosome order (rank, then name). */
export function compareChromosomes(a: string, b: string): number {
  const byRank = chromosomeRank(a) - chromosomeRank(b)
  if (byRank !== 0) return byRank
  return a < b ? -1 : a > b ? 1 : 0
}

const SAFE_COLUMN_REF = /^(?:[a-z_][a-z0-9_]*\.)?[a-z_][a-z0-9_]*$/i

/**
 * SQL expression for the natural rank of `column` (default `chr`).
 *
 * `column` is interpolated raw, so only plain (optionally alias-qualified)
 * identifiers are accepted. Index matching in both engines resolves column
 * references, so `chr`, `v.chr` and `variants.chr` all match an index built
 * on `chrRankSql('chr')`.
 */
export function chrRankSql(column = 'chr'): string {
  if (!SAFE_COLUMN_REF.test(column)) {
    throw new Error(`chrRankSql: unsafe column reference "${column}"`)
  }
  const normalized = `upper(CASE WHEN lower(substr(${column}, 1, 3)) = 'chr' THEN substr(${column}, 4) ELSE ${column} END)`
  const arms = NAMED_CONTIG_RANKS.map(([name, rank]) => `WHEN '${name}' THEN ${rank}`).join(' ')
  return `(CASE ${normalized} ${arms} ELSE ${OTHER_CONTIG_RANK} END)`
}

/**
 * SQL dialect of the sink. The only difference is the collation of the `chr`
 * name tiebreaker: SQLite compares TEXT bytewise (BINARY), PostgreSQL uses the
 * database collation (e.g. en_US, case-insensitive-ish), which would order
 * `chrUn_…` before `GL…`. PostgreSQL therefore uses `COLLATE "C"`, which is
 * bytewise too, so both backends order other contigs identically. The PG
 * indexes declare the same collation on their `chr` column.
 */
export type SqlDialect = 'sqlite' | 'postgres'

function chrNameTerm(column: string, dialect: SqlDialect): string {
  return dialect === 'postgres' ? `${column} COLLATE "C"` : column
}

/**
 * ORDER BY terms for a chromosome sort: rank, then the raw name (bytewise) as
 * the tiebreaker for non-standard contigs. `direction` is normalised here.
 */
export function chromosomeOrderTerms(
  column: string,
  direction: 'asc' | 'desc',
  dialect: SqlDialect = 'sqlite'
): string[] {
  const dir = direction === 'desc' ? 'DESC' : 'ASC'
  return [`${chrRankSql(column)} ${dir}`, `${chrNameTerm(column, dialect)} ${dir}`]
}

function qualify(alias: string, column: string): string {
  return alias === '' ? column : `${alias}.${column}`
}

/**
 * Genomic default order for a single-case variant query: rank, chr, pos.
 * Callers append their own unique tiebreaker (`id ASC`). `pos` is NOT NULL on
 * both backends, so no NULLS clause is emitted: SQLite cannot use an index
 * for `ASC NULLS LAST` because its native ASC order puts NULLs first.
 * Served by `idx_variants_case_chr_rank` on both backends.
 */
export function genomicVariantOrderTerms(alias: string, dialect: SqlDialect = 'sqlite'): string[] {
  return [
    ...chromosomeOrderTerms(qualify(alias, 'chr'), 'asc', dialect),
    `${qualify(alias, 'pos')} ASC`
  ]
}

/** A user sort already resolved to a whitelisted SQL column reference. */
export interface ResolvedVariantSort {
  key: string
  column: string
  order: 'asc' | 'desc'
}

/**
 * ORDER BY terms (without the unique `id` tiebreaker) for a single-case
 * variant query. Shared by the SQLite and PostgreSQL sinks so both emit the
 * same order:
 * - no sorts → `genomicVariantOrderTerms(alias)`;
 * - `chr` → natural chromosome order, then `pos ASC` unless pos is sorted too;
 * - anything else → `column DIR NULLS LAST`.
 */
export function buildVariantOrderTerms(
  sorts: ResolvedVariantSort[],
  alias: string,
  dialect: SqlDialect = 'sqlite'
): string[] {
  if (sorts.length === 0) return genomicVariantOrderTerms(alias, dialect)
  const hasPosSort = sorts.some((s) => s.key === 'pos')
  return sorts.flatMap((s) => {
    if (s.key !== 'chr') return [`${s.column} ${s.order === 'desc' ? 'DESC' : 'ASC'} NULLS LAST`]
    const terms = chromosomeOrderTerms(s.column, s.order, dialect)
    return hasPosSort ? terms : [...terms, `${qualify(alias, 'pos')} ASC`]
  })
}

/**
 * Full ORDER BY clause for a cohort query (summary table or live aggregate).
 *
 * - `sortKey === 'chr'`: natural chromosome order in `direction`, then
 *   pos/ref/alt ascending within each chromosome.
 * - any other key: `sortColumn direction NULLS LAST`, then the natural
 *   genomic tiebreaker (rank, chr, pos, ref, alt).
 *
 * `sortColumn` must come from a caller-side whitelist; it is emitted raw.
 * The default cohort order (`carrier_count DESC`) is served by
 * `idx_cvs_carrier_chr_rank`, and the chromosome sort by `idx_cvs_chr_rank`.
 */
export function cohortOrderByClause(
  sortKey: string,
  sortColumn: string,
  direction: 'asc' | 'desc',
  alias = '',
  dialect: SqlDialect = 'sqlite'
): string {
  const chr = qualify(alias, 'chr')
  const withinChromosome = ['pos', 'ref', 'alt'].map((c) => `${qualify(alias, c)} ASC`)
  const terms =
    sortKey === 'chr'
      ? [...chromosomeOrderTerms(chr, direction, dialect), ...withinChromosome]
      : [
          `${sortColumn} ${direction === 'asc' ? 'ASC' : 'DESC'} NULLS LAST`,
          ...chromosomeOrderTerms(chr, 'asc', dialect),
          ...withinChromosome
        ]
  return `ORDER BY ${terms.join(', ')}`
}
