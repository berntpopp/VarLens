/**
 * The representative annotation of a `cohort_variant_summary` row (#469).
 *
 * A summary row stands for every carrier of one (chr, pos, ref, alt,
 * variant_type, genome_build), but cases can annotate the same variant
 * differently (another transcript, another annotation release). The row shows
 * the annotation of ONE carrier row, the most severe:
 *
 *   impact_rank DESC, clinvar_rank DESC,
 *   then every annotation column DESC, NULL last, text compared bytewise
 *
 * The ranks are written at import from src/shared/config/severity.config.ts.
 * The trailing columns only make the order total: rows that tie on all of
 * them are identical in every stored column, so both backends, and every
 * maintenance path, arrive at the same summary row. Text is compared bytewise
 * (COLLATE "C" on PostgreSQL, SQLite's default BINARY).
 *
 * Every path that writes the summary builds its SQL from this module: full
 * rebuild, add at publication, removal, transcript switch, coordinate
 * recompute. Pure SQL text: safe in main, workers and both storage backends.
 */
import type { SqlDialect } from './chromosome-order'

/** The stored severity ranks, in order of precedence. NOT NULL, 0 = unknown. */
export const REPRESENTATIVE_RANK_COLUMNS = ['impact_rank', 'clinvar_rank'] as const

/** Tie-break columns in order of precedence; `text` ones compare bytewise. */
export const REPRESENTATIVE_TIE_BREAK_COLUMNS = [
  { name: 'func', text: true },
  { name: 'gene_symbol', text: true },
  { name: 'transcript', text: true },
  { name: 'cdna', text: true },
  { name: 'aa_change', text: true },
  { name: 'consequence', text: true },
  { name: 'clinvar', text: true },
  { name: 'omim_mim_number', text: true },
  { name: 'gnomad_af', text: false },
  { name: 'cadd', text: false },
  { name: 'end_pos', text: false }
] as const

/** Annotation columns a summary row copies from its representative carrier row. */
export const REPRESENTATIVE_ANNOTATION_COLUMNS = REPRESENTATIVE_TIE_BREAK_COLUMNS.map(
  (column) => column.name
)

/** Every summary column that comes from the representative row: annotation, then ranks. */
export const REPRESENTATIVE_COLUMNS: readonly string[] = [
  ...REPRESENTATIVE_ANNOTATION_COLUMNS,
  ...REPRESENTATIVE_RANK_COLUMNS
]

type TieBreakColumn = (typeof REPRESENTATIVE_TIE_BREAK_COLUMNS)[number]

/** A column reference that compares the way the order says. */
function comparable(column: TieBreakColumn, alias: string, dialect: SqlDialect): string {
  const reference = `${alias}.${column.name}`
  return column.text && dialect === 'postgres' ? `${reference} COLLATE "C"` : reference
}

const distinct = (dialect: SqlDialect): string =>
  dialect === 'postgres' ? 'IS DISTINCT FROM' : 'IS NOT'

const notDistinct = (dialect: SqlDialect): string =>
  dialect === 'postgres' ? 'IS NOT DISTINCT FROM' : 'IS'

/** `alias.col, alias.col, ...` for every representative column. */
export function representativeColumnList(alias: string): string {
  return REPRESENTATIVE_COLUMNS.map((column) => `${alias}.${column}`).join(', ')
}

/**
 * ORDER BY terms that put the representative row first. Use in
 * `ROW_NUMBER() OVER (PARTITION BY <key> ORDER BY ...)`.
 */
export function representativeOrderBy(alias: string, dialect: SqlDialect): string {
  return [
    ...REPRESENTATIVE_RANK_COLUMNS.map((column) => `${alias}.${column} DESC`),
    ...REPRESENTATIVE_TIE_BREAK_COLUMNS.map(
      (column) => `${comparable(column, alias, dialect)} DESC NULLS LAST`
    )
  ].join(', ')
}

/**
 * Boolean expression: row `candidate` comes strictly before row `current` in
 * the order, i.e. it must replace `current` as the representative.
 */
export function precedesRepresentative(
  candidate: string,
  current: string,
  dialect: SqlDialect
): string {
  const ranks = REPRESENTATIVE_RANK_COLUMNS.map(
    (column) =>
      `WHEN ${candidate}.${column} <> ${current}.${column} THEN ${candidate}.${column} > ${current}.${column}`
  )
  const tieBreaks = REPRESENTATIVE_TIE_BREAK_COLUMNS.map((column) => {
    const a = comparable(column, candidate, dialect)
    const b = comparable(column, current, dialect)
    // NULL sorts last, so a value beats NULL and NULL beats nothing.
    return `WHEN ${a} ${distinct(dialect)} ${b} THEN (${current}.${column.name} IS NULL OR (${candidate}.${column.name} IS NOT NULL AND ${a} > ${b}))`
  })
  return `(CASE ${[...ranks, ...tieBreaks].join('\n      ')} ELSE ${dialect === 'postgres' ? 'false' : '0'} END)`
}

/** Boolean expression: rows `a` and `b` agree on every representative column. */
export function sameRepresentative(a: string, b: string, dialect: SqlDialect): string {
  return [
    ...REPRESENTATIVE_RANK_COLUMNS.map((column) => `${a}.${column} = ${b}.${column}`),
    ...REPRESENTATIVE_TIE_BREAK_COLUMNS.map(
      (column) =>
        `${comparable(column, a, dialect)} ${notDistinct(dialect)} ${comparable(column, b, dialect)}`
    )
  ].join(' AND ')
}
