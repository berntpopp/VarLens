/**
 * Severity configuration: the one place that knows how annotation values rank.
 *
 * Two scales, both "higher is more severe", both with 0 for unknown / NULL:
 *
 *   impact    the IMPACT level stored in `variants.consequence`
 *   ClinVar   the clinical-significance string stored in `variants.clinvar`,
 *             normalised to a category first
 *
 * The ranks are stored on every variant row at import (`impact_rank`,
 * `clinvar_rank`) and decide which carrier annotation represents a variant in
 * the cohort summary (src/shared/sql/cohort-representative.ts). Changing an
 * order here therefore needs a migration that recomputes the stored ranks.
 *
 * Terms and their grouping follow ClinVar's documentation
 * (https://www.ncbi.nlm.nih.gov/clinvar/docs/clinsig/); the design and the
 * reasons for the order are in
 * .planning/specs/2026-10-07-cohort-representative-severity.md.
 *
 * Pure data and string functions: safe in main, workers, preload and renderer.
 */

import { ACMG_CLASSIFICATIONS, type AcmgClassification } from './domain.config'

/** Rank of a missing or unrecognised value on either scale. */
export const UNKNOWN_SEVERITY_RANK = 0

/** Impact levels, most severe first. */
export const IMPACT_LEVELS = [
  { level: 'HIGH', rank: 4 },
  { level: 'MODERATE', rank: 3 },
  { level: 'LOW', rank: 2 },
  { level: 'MODIFIER', rank: 1 }
] as const

export type ImpactLevel = (typeof IMPACT_LEVELS)[number]['level']

/**
 * Exact-key lookup (`HIGH` → 4). For callers that compare annotation fields as
 * they are spelled in the file; use {@link impactRank} for a stored rank.
 */
export const IMPACT_RANK_BY_LEVEL: Readonly<Record<string, number>> = Object.freeze(
  Object.fromEntries(IMPACT_LEVELS.map(({ level, rank }) => [level, rank]))
)

/** Rank of the most severe impact level. */
export const MAX_IMPACT_RANK: number = Math.max(...IMPACT_LEVELS.map(({ rank }) => rank))

/** Stored rank of an impact value: space-trimmed, ASCII case-insensitive, 0 when unknown. */
export function impactRank(value: string | null | undefined): number {
  if (value === null || value === undefined) return UNKNOWN_SEVERITY_RANK
  return IMPACT_RANK_BY_LEVEL[asciiUpperTrimmed(value)] ?? UNKNOWN_SEVERITY_RANK
}

/** What SQL `upper(trim(x))` yields on both backends for the level names: ASCII only. */
function asciiUpperTrimmed(value: string): string {
  return value.replace(/^ +| +$/g, '').replace(/[a-z]/g, (letter) => letter.toUpperCase())
}

/**
 * SQL `CASE` computing {@link impactRank} for a text expression. Valid on
 * PostgreSQL and SQLite; used by the backfill migrations.
 */
export function impactRankCaseSql(expression: string): string {
  const whens = IMPACT_LEVELS.map(({ level, rank }) => `WHEN '${level}' THEN ${rank}`).join(' ')
  return `CASE upper(trim(${expression})) ${whens} ELSE ${UNKNOWN_SEVERITY_RANK} END`
}

/**
 * ACMG/AMP classification of a variant by the user (`acmg_classification`),
 * most severe first. The labels are the canonical ones of domain.config.ts;
 * the summary's `acmg_best` is the highest-ranked class any annotation gives.
 */
export const ACMG_RANKS: ReadonlyArray<{ label: AcmgClassification; rank: number }> =
  ACMG_CLASSIFICATIONS.map((label, index) => ({
    label,
    rank: ACMG_CLASSIFICATIONS.length - index
  }))

/** Rank of an ACMG class label (exact, as stored), 0 when unknown or NULL. */
export function acmgRank(label: string | null | undefined): number {
  return ACMG_RANKS.find((entry) => entry.label === label)?.rank ?? UNKNOWN_SEVERITY_RANK
}

/** SQL `CASE` giving the rank of an ACMG class expression (0 when unknown). */
export function acmgRankCaseSql(expression: string): string {
  const whens = ACMG_RANKS.map(({ label, rank }) => `WHEN '${label}' THEN ${rank}`).join(' ')
  return `CASE ${expression} ${whens} ELSE ${UNKNOWN_SEVERITY_RANK} END`
}

/** SQL `CASE` giving the ACMG class label of a rank expression (NULL for 0). */
export function acmgLabelCaseSql(rankExpression: string): string {
  const whens = ACMG_RANKS.map(({ label, rank }) => `WHEN ${rank} THEN '${label}'`).join(' ')
  return `CASE ${rankExpression} ${whens} ELSE NULL END`
}

/**
 * ClinVar clinical-significance categories, most severe first.
 *
 * `terms` are the normalised spellings (see {@link normalizeClinvarTerm}) that
 * map to the category: ClinVar's own terms, the usual abbreviations and
 * synonyms, and the numeric codes of the legacy ClinVar VCF (0 uncertain, 1 not
 * provided, 2 benign, 3 likely benign, 4 likely pathogenic, 5 pathogenic,
 * 6 drug response, 7 histocompatibility, 255 other). The two aggregate
 * categories and `conflicting` can also be derived from components.
 *
 * `components`: an aggregate category names the categories it is made of
 * (ClinVar reports `Pathogenic/Likely pathogenic` when submitters are split
 * between the two). A filter on a component also selects the aggregate, see
 * {@link severityFilterParts}; a filter on the aggregate selects only it.
 *
 * `color` is the chip colour token of the category in both views (grey =
 * neutral), so every spelling of a category looks the same.
 *
 * `axis`: `pathogenicity` categories classify the variant for Mendelian
 * disease; `other` ones are classifications of another kind (ClinVar reports
 * them next to the first, separated by `|`); `none` says nothing.
 */
export const CLINVAR_CATEGORIES = [
  {
    id: 'pathogenic',
    components: [],
    color: 'error',
    label: 'Pathogenic',
    rank: 15,
    axis: 'pathogenicity',
    terms: ['pathogenic', 'p', '5']
  },
  {
    id: 'pathogenic_likely_pathogenic',
    components: ['pathogenic', 'likely_pathogenic'],
    color: 'orange',
    label: 'Pathogenic/Likely pathogenic',
    rank: 14,
    axis: 'pathogenicity',
    terms: []
  },
  {
    id: 'likely_pathogenic',
    components: [],
    color: 'orange',
    label: 'Likely pathogenic',
    rank: 13,
    axis: 'pathogenicity',
    terms: ['likely pathogenic', 'lp', 'probable pathogenic', 'probably pathogenic', '4']
  },
  {
    id: 'conflicting',
    components: [],
    color: 'clinvar-conflicting',
    label: 'Conflicting classifications of pathogenicity',
    rank: 12,
    axis: 'pathogenicity',
    terms: [
      'conflicting classifications of pathogenicity',
      'conflicting interpretations of pathogenicity',
      'conflicting classifications of oncogenicity',
      'conflicting data from submitters',
      'conflicting classifications',
      'conflicting interpretations',
      'conflicting'
    ]
  },
  {
    id: 'uncertain_significance',
    components: [],
    color: 'warning',
    label: 'Uncertain significance',
    rank: 11,
    axis: 'pathogenicity',
    terms: [
      'uncertain significance',
      'vus',
      'vous',
      'vus high',
      'vus mid',
      'vus low',
      'uncertain',
      'unknown significance',
      'uncertain risk allele',
      '0'
    ]
  },
  {
    id: 'risk_factor',
    components: [],
    color: 'grey',
    label: 'Risk factor',
    rank: 10,
    axis: 'other',
    terms: ['risk factor', 'established risk allele', 'likely risk allele']
  },
  {
    id: 'association',
    components: [],
    color: 'grey',
    label: 'Association',
    rank: 9,
    axis: 'other',
    terms: ['association']
  },
  {
    id: 'affects',
    components: [],
    color: 'grey',
    label: 'Affects',
    rank: 8,
    axis: 'other',
    terms: ['affects']
  },
  {
    id: 'drug_response',
    components: [],
    color: 'grey',
    label: 'Drug response',
    rank: 7,
    axis: 'other',
    terms: ['drug response', 'confers sensitivity', 'conferring sensitivity', '6']
  },
  {
    id: 'other',
    components: [],
    color: 'grey',
    label: 'Other',
    rank: 6,
    axis: 'other',
    terms: [
      'other',
      'association not found',
      'histocompatibility',
      'oncogenic',
      'likely oncogenic',
      'tier i strong',
      'tier ii potential',
      'tier iii uncertain significance',
      'tier iv benign/likely benign',
      '7',
      '255'
    ]
  },
  {
    id: 'protective',
    components: [],
    color: 'grey',
    label: 'Protective',
    rank: 5,
    axis: 'other',
    terms: ['protective']
  },
  {
    id: 'likely_benign',
    components: [],
    color: 'light-green',
    label: 'Likely benign',
    rank: 4,
    axis: 'pathogenicity',
    terms: ['likely benign', 'lb', 'probable benign', 'probably benign', '3']
  },
  {
    id: 'benign_likely_benign',
    components: ['likely_benign', 'benign'],
    color: 'light-green',
    label: 'Benign/Likely benign',
    rank: 3,
    axis: 'pathogenicity',
    terms: []
  },
  {
    id: 'benign',
    components: [],
    color: 'success',
    label: 'Benign',
    rank: 2,
    axis: 'pathogenicity',
    terms: ['benign', 'b', '2']
  },
  {
    id: 'not_provided',
    components: [],
    color: 'grey',
    label: 'Not provided',
    rank: 1,
    axis: 'none',
    terms: [
      'not provided',
      'no classification provided',
      'no classification for the single variant',
      'no classifications from unflagged records',
      'no interpretation for the single variant',
      'no assertion provided',
      '1'
    ]
  }
] as const

export type ClinvarCategoryId = (typeof CLINVAR_CATEGORIES)[number]['id']

/**
 * Components that qualify a classification without being one. The comma split
 * separates them from their term ("Pathogenic, low penetrance").
 */
export const CLINVAR_MODIFIER_TERMS: readonly string[] = ['low penetrance']

/** Whole strings that stand for "no value given". */
const CLINVAR_PLACEHOLDERS: readonly string[] = ['.', '-']

/** Characters that separate the components of a multi-valued string. */
export const CLINVAR_COMPONENT_SEPARATOR = /[&/,|;]/

const CATEGORY_BY_ID = new Map<string, (typeof CLINVAR_CATEGORIES)[number]>(
  CLINVAR_CATEGORIES.map((category) => [category.id, category])
)

const RANK_BY_CATEGORY: Readonly<Record<string, number>> = Object.freeze(
  Object.fromEntries(CLINVAR_CATEGORIES.map(({ id, rank }) => [id, rank]))
)

const CATEGORY_BY_TERM: ReadonlyMap<string, ClinvarCategoryId> = new Map(
  CLINVAR_CATEGORIES.flatMap(({ id, terms }) =>
    (terms as readonly string[]).map((term): [string, ClinvarCategoryId] => [term, id])
  )
)

const PATHOGENIC_SIDE: readonly ClinvarCategoryId[] = [
  'pathogenic',
  'pathogenic_likely_pathogenic',
  'likely_pathogenic'
]
const BENIGN_SIDE: readonly ClinvarCategoryId[] = [
  'likely_benign',
  'benign_likely_benign',
  'benign'
]

/**
 * Lower case; underscores, hyphens and typographic dashes to spaces; single
 * spaces; trimmed. `Likely_pathogenic`, `likely-pathogenic` and
 * `Likely  Pathogenic` are one term.
 */
export function normalizeClinvarTerm(term: string): string {
  return term
    .toLowerCase()
    .replace(/[_\-\u2010-\u2015]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Submitter counts (`Pathogenic(1)`) and other parenthesised suffixes. */
const PARENTHESISED = /\([^()]*\)/g

/** The recognised component categories of a raw string, without duplicates. */
function componentCategories(raw: string): Set<ClinvarCategoryId> {
  const found = new Set<ClinvarCategoryId>()
  if (CLINVAR_PLACEHOLDERS.includes(raw.trim())) return found.add('not_provided')
  const text = raw.replace(PARENTHESISED, ' ')
  // "Tier IV - Benign/Likely benign" contains a separator: try the whole first.
  const whole = CATEGORY_BY_TERM.get(normalizeClinvarTerm(text))
  if (whole !== undefined) return found.add(whole)
  for (const part of text.split(CLINVAR_COMPONENT_SEPARATOR)) {
    const term = normalizeClinvarTerm(part)
    if (term === '' || CLINVAR_MODIFIER_TERMS.includes(term)) continue
    const category = CATEGORY_BY_TERM.get(term)
    if (category !== undefined) found.add(category)
  }
  return found
}

function mostSevere(categories: Iterable<ClinvarCategoryId>): ClinvarCategoryId | null {
  let best: ClinvarCategoryId | null = null
  for (const category of categories) {
    if (best === null || RANK_BY_CATEGORY[category] > RANK_BY_CATEGORY[best]) best = category
  }
  return best
}

/**
 * Category of a raw ClinVar significance string, or null when it is empty or
 * nothing in it is recognised.
 *
 * Multi-valued strings (`&`, `/`, `,`, `|`, `;`):
 *  1. A classification on the pathogenicity axis is never outranked by a term
 *     of another kind attached to it (`Benign/Likely_benign|other` is benign /
 *     likely benign); such terms count only when there is no classification.
 *  2. A pathogenic-side and a benign-side component together are `conflicting`.
 *     ClinVar reports that itself for one variant; a VEP `CLIN_SIG` lists the
 *     significance of every co-located record (it is not allele-specific) with
 *     no aggregate, so `pathogenic&benign` asserts neither.
 *  3. Pathogenic with likely pathogenic, and benign with likely benign when
 *     nothing is more severe, give ClinVar's aggregate category.
 *  4. Otherwise the most severe component wins.
 */
export function clinvarCategory(raw: string | null | undefined): ClinvarCategoryId | null {
  if (raw === null || raw === undefined) return null
  const found = componentCategories(raw)
  if (found.size === 0) return null
  const classified = [...found].filter(
    (category) => CATEGORY_BY_ID.get(category)?.axis === 'pathogenicity'
  )
  if (classified.length === 0) return mostSevere(found)

  const has = (category: ClinvarCategoryId): boolean => found.has(category)
  if (PATHOGENIC_SIDE.some(has) && BENIGN_SIDE.some(has)) return 'conflicting'
  if (has('pathogenic') && has('likely_pathogenic')) return 'pathogenic_likely_pathogenic'
  const best = mostSevere(classified)
  if (best === 'likely_benign' && has('benign')) return 'benign_likely_benign'
  return best
}

const UNRANKED_CLINVAR_LIMIT = 100
const unrankedClinvar = new Set<string>()

/**
 * The distinct non-empty ClinVar strings that got rank 0 since the last call,
 * at most {@link UNRANKED_CLINVAR_LIMIT}. An import calls this when it is done
 * and logs what it gets, so real-world spellings the configuration does not
 * know yet surface instead of silently ranking as unknown.
 */
export function takeUnrankedClinvarStrings(): string[] {
  const strings = [...unrankedClinvar]
  unrankedClinvar.clear()
  return strings
}

function noteUnranked(raw: string): void {
  if (unrankedClinvar.size < UNRANKED_CLINVAR_LIMIT && raw.trim() !== '') unrankedClinvar.add(raw)
}

const CLINVAR_RANK_CACHE_LIMIT = 10_000
const clinvarRankCache = new Map<string, number>()

/** Rank of a raw ClinVar significance string, 0 when unknown. */
export function clinvarRank(raw: string | null | undefined): number {
  if (raw === null || raw === undefined) return UNKNOWN_SEVERITY_RANK
  let rank = clinvarRankCache.get(raw)
  if (rank === undefined) {
    const category = clinvarCategory(raw)
    rank = category === null ? UNKNOWN_SEVERITY_RANK : RANK_BY_CATEGORY[category]
    // An import sees a few hundred distinct strings; the cap only bounds abuse.
    if (clinvarRankCache.size >= CLINVAR_RANK_CACHE_LIMIT) clinvarRankCache.clear()
    clinvarRankCache.set(raw, rank)
  }
  return rank
}

/**
 * The rank an import stores for a ClinVar string. Like {@link clinvarRank},
 * and a string that cannot be ranked is remembered for the import's report
 * ({@link takeUnrankedClinvarStrings}).
 */
export function clinvarRankForImport(raw: string | null | undefined): number {
  const rank = clinvarRank(raw)
  if (rank === UNKNOWN_SEVERITY_RANK && typeof raw === 'string') noteUnranked(raw)
  return rank
}

/** The two stored ranks of a variant row. */
export interface AnnotationSeverityRanks {
  impact_rank: number
  clinvar_rank: number
}

/** Ranks an import stores for the `consequence` (impact) and `clinvar` values of a variant row. */
export function annotationSeverityRanks(row: {
  consequence?: unknown
  clinvar?: unknown
}): AnnotationSeverityRanks {
  return {
    impact_rank: impactRank(typeof row.consequence === 'string' ? row.consequence : null),
    clinvar_rank: clinvarRankForImport(typeof row.clinvar === 'string' ? row.clinvar : null)
  }
}

/** Filter and sort keys that are matched by severity category, not by text. */
export type SeverityKey = 'consequence' | 'clinvar'

export function isSeverityKey(key: string): key is SeverityKey {
  return key === 'consequence' || key === 'clinvar'
}

const severityRank = (key: SeverityKey, value: string): number =>
  key === 'clinvar' ? clinvarRank(value) : impactRank(value)

const LABEL_BY_RANK: Readonly<Record<SeverityKey, ReadonlyMap<number, string>>> = {
  consequence: new Map(IMPACT_LEVELS.map(({ level, rank }) => [rank, level])),
  clinvar: new Map(CLINVAR_CATEGORIES.map(({ label, rank }) => [rank, label]))
}

/** Rank of a ClinVar category → ranks of the aggregate categories that contain it. */
const AGGREGATE_RANKS: ReadonlyMap<number, number[]> = (() => {
  const containing = new Map<number, number[]>()
  for (const aggregate of CLINVAR_CATEGORIES) {
    for (const component of aggregate.components as readonly string[]) {
      const rank = RANK_BY_CATEGORY[component]
      containing.set(rank, [...(containing.get(rank) ?? []), aggregate.rank])
    }
  }
  return containing
})()

/**
 * What filter values for a severity column select: every row of the ranks
 * (categories) the values belong to, and, for values that are no known
 * category, the rows with exactly that text. `Pathogenic` therefore also
 * selects `pathogenic` and `Pathogenic|drug_response`. A ClinVar category
 * also selects the aggregates that contain it (`Pathogenic` and `Likely
 * pathogenic` each include `Pathogenic/Likely pathogenic`), as the
 * configuration declares; an aggregate selects only itself.
 */
export function severityFilterParts(
  key: SeverityKey,
  values: readonly unknown[]
): { ranks: number[]; raw: string[] } {
  const ranks = new Set<number>()
  const raw = new Set<string>()
  for (const value of values) {
    const text = String(value)
    const rank = severityRank(key, text)
    if (rank === UNKNOWN_SEVERITY_RANK) raw.add(text)
    else ranks.add(rank)
    if (key === 'clinvar')
      for (const aggregate of AGGREGATE_RANKS.get(rank) ?? []) ranks.add(aggregate)
  }
  return { ranks: [...ranks].sort((a, b) => b - a), raw: [...raw] }
}

/**
 * The filter values to offer for a column, given the distinct stored values:
 * for a severity column the configured categories that occur, most severe
 * first, then the stored strings that are no known category; any other column
 * unchanged. The stored strings themselves stay what is displayed.
 */
export function offeredFilterValues(key: string, distinctValues: string[]): string[] {
  if (!isSeverityKey(key)) return distinctValues
  // The categories that occur themselves: an aggregate is offered only when
  // some stored value is that aggregate.
  const ranks = new Set<number>()
  const raw = new Set<string>()
  for (const value of distinctValues) {
    const rank = severityRank(key, value)
    if (rank === UNKNOWN_SEVERITY_RANK) raw.add(value)
    else ranks.add(rank)
  }
  return [
    ...[...ranks].sort((a, b) => b - a).map((rank) => LABEL_BY_RANK[key].get(rank) as string),
    ...[...raw].sort()
  ]
}

/** A column's filter metadata with its distinct values replaced by the values to offer. */
export function withOfferedValues<T extends { key: string; distinctValues?: string[] }>(
  meta: T
): T {
  if (meta.distinctValues === undefined || !isSeverityKey(meta.key)) return meta
  return { ...meta, distinctValues: offeredFilterValues(meta.key, meta.distinctValues) }
}

/** Colour token of a value that has no category. */
export const NEUTRAL_SEVERITY_COLOR = 'grey'

/**
 * Chip colour token for a raw ClinVar string: its category's, so `LB`,
 * `Likely_benign` and `likely benign` look alike; neutral when unknown.
 */
export function clinvarColorToken(raw: string | null | undefined): string {
  const category = clinvarCategory(raw)
  return category === null
    ? NEUTRAL_SEVERITY_COLOR
    : (CATEGORY_BY_ID.get(category)?.color ?? NEUTRAL_SEVERITY_COLOR)
}

/**
 * How a raw ClinVar string is shown, in a table cell and in a filter option
 * alike: as stored, with underscores as spaces.
 */
export function clinvarDisplayText(raw: string): string {
  return raw.replace(/_/g, ' ')
}
