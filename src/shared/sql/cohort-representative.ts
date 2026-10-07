/**
 * What a `cohort_variant_summary` row shows for its variant (#469).
 *
 * A summary row stands for every carrier of one (chr, pos, ref, alt,
 * variant_type, genome_build), but cases can annotate the same variant
 * differently (another transcript, another annotation release). Its
 * annotation columns are of two kinds:
 *
 * TRANSCRIPT-LEVEL columns describe one transcript and only make sense
 * together. They come from ONE carrier row, the most severe:
 *
 *   impact_rank DESC, then func, gene_symbol, transcript, cdna, aa_change,
 *   consequence, omim_mim_number, each DESC, NULL last, text bytewise
 *
 * VARIANT-LEVEL facts describe the variant itself. Each is aggregated over
 * ALL carrier rows on its own, so a fact one carrier has is never lost
 * because another carrier supplies the transcript:
 *
 *   clinvar      the string with the highest clinvar_rank, ties by the string
 *                bytewise (its rank is stored next to it)
 *   gnomad_af    the lowest frequency   (NULL only when no carrier has one)
 *   cadd         the highest score
 *   end_pos      the highest end
 *
 * Carriers of one annotation release agree on these; they differ only across
 * releases, and then the value that is least likely to hide the variant from
 * a filter is kept ("most severe", per column).
 *
 * Both kinds are plain orders, so both backends and every maintenance path
 * arrive at the same row: text is compared bytewise (COLLATE "C" on
 * PostgreSQL, SQLite's default BINARY). The ranks are written at import from
 * src/shared/config/severity.config.ts.
 *
 * Every path that writes the summary builds its SQL from this module: full
 * rebuild, add at publication, removal, transcript switch, coordinate
 * recompute. Pure SQL text: safe in main, workers and both storage backends.
 */
import type { SqlDialect } from './chromosome-order'

/** Transcript-level columns, in tie-break order of precedence; all text. */
export const TRANSCRIPT_COLUMNS = [
  'func',
  'gene_symbol',
  'transcript',
  'cdna',
  'aa_change',
  'consequence',
  'omim_mim_number'
] as const

/** Variant-level numeric facts and the direction that is kept. */
export const NUMERIC_FACTS = [
  { name: 'gnomad_af', keep: 'min' },
  { name: 'cadd', keep: 'max' },
  { name: 'end_pos', keep: 'max' }
] as const

/** Summary columns copied together from the chosen carrier row. */
export const SUMMARY_TRANSCRIPT_COLUMNS: readonly string[] = [...TRANSCRIPT_COLUMNS, 'impact_rank']

/** Summary columns aggregated over all carriers. */
export const SUMMARY_FACT_COLUMNS: readonly string[] = [
  'clinvar',
  'clinvar_rank',
  ...NUMERIC_FACTS.map((fact) => fact.name)
]

/** Every annotation column of a summary row. */
export const REPRESENTATIVE_COLUMNS: readonly string[] = [
  ...SUMMARY_TRANSCRIPT_COLUMNS,
  ...SUMMARY_FACT_COLUMNS
]

/** SQL giving the two severity ranks of a carrier row. */
export interface CarrierRanks {
  impact: string
  clinvar: string
}

/** The ranks as stored columns of `alias` (NOT NULL). */
export const storedRanks = (alias: string): CarrierRanks => ({
  impact: `${alias}.impact_rank`,
  clinvar: `${alias}.clinvar_rank`
})

const text = (reference: string, dialect: SqlDialect): string =>
  dialect === 'postgres' ? `${reference} COLLATE "C"` : reference

const distinct = (dialect: SqlDialect): string =>
  dialect === 'postgres' ? 'IS DISTINCT FROM' : 'IS NOT'

const notDistinct = (dialect: SqlDialect): string =>
  dialect === 'postgres' ? 'IS NOT DISTINCT FROM' : 'IS'

const falseLiteral = (dialect: SqlDialect): string => (dialect === 'postgres' ? 'false' : '0')

/** `alias.col, alias.col, ...` for every annotation column of the summary. */
export function representativeColumnList(alias: string): string {
  return REPRESENTATIVE_COLUMNS.map((column) => `${alias}.${column}`).join(', ')
}

/**
 * ORDER BY terms that put the carrier row supplying the transcript-level
 * columns first. Use in `ROW_NUMBER() OVER (<window> ORDER BY ...)`.
 */
export function transcriptOrderBy(
  alias: string,
  dialect: SqlDialect,
  ranks: CarrierRanks = storedRanks(alias)
): string {
  return [
    `${ranks.impact} DESC`,
    ...TRANSCRIPT_COLUMNS.map((column) => `${text(`${alias}.${column}`, dialect)} DESC NULLS LAST`)
  ].join(', ')
}

/**
 * The ClinVar string of the highest rank in the window, ties by the string.
 * One aggregate: the rank is prefixed as a single character (ranks are small
 * positive integers), the maximum taken bytewise, the prefix removed.
 */
function clinvarOverWindow(
  alias: string,
  window: string,
  dialect: SqlDialect,
  rank: string
): string {
  const character = dialect === 'postgres' ? 'chr' : 'char'
  const keyed = `${character}(64 + ${rank}) || ${alias}.clinvar`
  return `substr(MAX(${dialect === 'postgres' ? `(${keyed}) COLLATE "C"` : keyed}) OVER ${window}, 2)`
}

/**
 * Select-list items giving every annotation column of the summary for the
 * rows of `window` (a named window partitioned by the summary key, or by key
 * and case): the transcript-level columns of the current row and the
 * variant-level facts of the whole partition. Keep the row that
 * {@link transcriptOrderBy} puts first and the list is the summary row.
 */
export function summaryColumnsOverWindow(
  alias: string,
  window: string,
  dialect: SqlDialect,
  ranks: CarrierRanks = storedRanks(alias)
): string {
  return [
    ...TRANSCRIPT_COLUMNS.map((column) => `${alias}.${column}`),
    `${ranks.impact} AS impact_rank`,
    `${clinvarOverWindow(alias, window, dialect, ranks.clinvar)} AS clinvar`,
    `MAX(${ranks.clinvar}) OVER ${window} AS clinvar_rank`,
    ...NUMERIC_FACTS.map(
      (fact) =>
        `${fact.keep === 'min' ? 'MIN' : 'MAX'}(${alias}.${fact.name}) OVER ${window} AS ${fact.name}`
    )
  ].join(',\n        ')
}

/**
 * Boolean: the transcript-level columns of row `candidate` must replace those
 * of row `current` (it comes strictly before it in the order). Both rows carry
 * stored ranks (a staged case contribution, a summary row).
 */
export function precedesTranscript(
  candidate: string,
  current: string,
  dialect: SqlDialect
): string {
  const whens = [
    `WHEN ${candidate}.impact_rank <> ${current}.impact_rank THEN ${candidate}.impact_rank > ${current}.impact_rank`,
    ...TRANSCRIPT_COLUMNS.map((column) => {
      const a = text(`${candidate}.${column}`, dialect)
      const b = text(`${current}.${column}`, dialect)
      // NULL sorts last, so a value beats NULL and NULL beats nothing.
      return `WHEN ${a} ${distinct(dialect)} ${b} THEN (${current}.${column} IS NULL OR (${candidate}.${column} IS NOT NULL AND ${a} > ${b}))`
    })
  ]
  return `(CASE ${whens.join('\n      ')} ELSE ${falseLiteral(dialect)} END)`
}

/** Boolean: rows `a` and `b` have the same transcript-level columns. */
export function sameTranscript(a: string, b: string, dialect: SqlDialect): string {
  // The impact rank is a function of `consequence`, so the text decides.
  return TRANSCRIPT_COLUMNS.map(
    (column) => `${a}.${column} ${notDistinct(dialect)} ${b}.${column}`
  ).join(' AND ')
}

/** Boolean: rows `a` and `b` agree on every annotation column of the summary. */
export function sameSummaryColumns(a: string, b: string, dialect: SqlDialect): string {
  return REPRESENTATIVE_COLUMNS.map(
    (column) => `${a}.${column} ${notDistinct(dialect)} ${b}.${column}`
  ).join(' AND ')
}

/** A variant-level fact as the maintenance paths see it. */
export interface SummaryFact {
  /** The summary columns that change together. */
  columns: readonly string[]
  /** Boolean: the value of row `candidate` must replace the stored one of `current`. */
  raises(candidate: string, current: string, dialect: SqlDialect): string
  /**
   * Boolean: row `removed` holds the stored value of `stored`, so taking it
   * away may change it. A row that only shares the value with others does too.
   */
  heldBy(removed: string, stored: string): string
  /** Boolean: carrier row `remaining` still supplies what `removed` held. */
  suppliedBy(remaining: string, removed: string): string
}

const CLINVAR_FACT: SummaryFact = {
  columns: ['clinvar', 'clinvar_rank'],
  raises: (candidate, current, dialect) =>
    `(${candidate}.clinvar IS NOT NULL AND (${current}.clinvar IS NULL
        OR ${candidate}.clinvar_rank > ${current}.clinvar_rank
        OR (${candidate}.clinvar_rank = ${current}.clinvar_rank
            AND ${text(`${candidate}.clinvar`, dialect)} > ${text(`${current}.clinvar`, dialect)})))`,
  heldBy: (removed, stored) =>
    `(${removed}.clinvar IS NOT NULL AND ${removed}.clinvar = ${stored}.clinvar)`,
  suppliedBy: (remaining, removed) => `${remaining}.clinvar = ${removed}.clinvar`
}

const numericFact = ({ name, keep }: (typeof NUMERIC_FACTS)[number]): SummaryFact => ({
  columns: [name],
  raises: (candidate, current) =>
    `(${candidate}.${name} IS NOT NULL AND (${current}.${name} IS NULL
        OR ${candidate}.${name} ${keep === 'min' ? '<' : '>'} ${current}.${name}))`,
  heldBy: (removed, stored) =>
    `(${removed}.${name} IS NOT NULL AND ${removed}.${name} = ${stored}.${name})`,
  suppliedBy: (remaining, removed) => `${remaining}.${name} = ${removed}.${name}`
})

/** The variant-level facts, each maintained on its own. */
export const SUMMARY_FACTS: readonly SummaryFact[] = [
  CLINVAR_FACT,
  ...NUMERIC_FACTS.map(numericFact)
]

/**
 * Boolean: adding case contribution `candidate` changes an annotation column
 * of summary row `current`.
 */
export function contributionChangesSummary(
  candidate: string,
  current: string,
  dialect: SqlDialect
): string {
  return [
    precedesTranscript(candidate, current, dialect),
    ...SUMMARY_FACTS.map((fact) => fact.raises(candidate, current, dialect))
  ].join('\n    OR ')
}

/**
 * Boolean: removing case contribution `removed` may change an annotation
 * column of summary row `stored` (it supplies the transcript or holds a fact).
 */
export function removalAffectsSummary(
  removed: string,
  stored: string,
  dialect: SqlDialect
): string {
  return [
    `(${sameTranscript(removed, stored, dialect)})`,
    ...SUMMARY_FACTS.map((fact) => fact.heldBy(removed, stored))
  ].join('\n        OR ')
}

/**
 * Boolean: carrier row `remaining` alone still supplies everything `removed`
 * supplied to `stored`. One such row means nothing has to be recomputed; in a
 * cohort that annotates a variant uniformly the first row probed is one.
 */
export function remainingRowCovers(
  remaining: string,
  removed: string,
  stored: string,
  dialect: SqlDialect
): string {
  return [
    `(NOT (${sameTranscript(removed, stored, dialect)}) OR (${sameTranscript(remaining, stored, dialect)}))`,
    ...SUMMARY_FACTS.map(
      (fact) => `(NOT ${fact.heldBy(removed, stored)} OR ${fact.suppliedBy(remaining, removed)})`
    )
  ].join('\n            AND ')
}

/**
 * `column = <merged value>` assignments for the variant-level facts when case
 * contribution `candidate` is added to summary row `current`.
 */
export function mergeFactAssignments(
  candidate: string,
  current: string,
  dialect: SqlDialect
): string[] {
  return SUMMARY_FACTS.flatMap((fact) =>
    fact.columns.map(
      (column) =>
        `${column} = CASE WHEN ${fact.raises(candidate, current, dialect)} THEN ${candidate}.${column} ELSE ${current}.${column} END`
    )
  )
}
