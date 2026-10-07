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
 * ClinVar clinical-significance categories, most severe first. `terms` are the
 * normalised spellings (lower case, spaces) that map to the category; the two
 * aggregate categories have none because they are derived from components.
 */
export const CLINVAR_CATEGORIES = [
  { id: 'pathogenic', label: 'Pathogenic', rank: 15, terms: ['pathogenic'] },
  {
    id: 'pathogenic_likely_pathogenic',
    label: 'Pathogenic/Likely pathogenic',
    rank: 14,
    terms: []
  },
  { id: 'likely_pathogenic', label: 'Likely pathogenic', rank: 13, terms: ['likely pathogenic'] },
  {
    id: 'conflicting',
    label: 'Conflicting classifications of pathogenicity',
    rank: 12,
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
    label: 'Uncertain significance',
    rank: 11,
    terms: [
      'uncertain significance',
      'vus',
      'vus-high',
      'vus-mid',
      'vus-low',
      'uncertain',
      'uncertain risk allele'
    ]
  },
  {
    id: 'risk_factor',
    label: 'Risk factor',
    rank: 10,
    terms: ['risk factor', 'established risk allele', 'likely risk allele']
  },
  { id: 'association', label: 'Association', rank: 9, terms: ['association'] },
  { id: 'affects', label: 'Affects', rank: 8, terms: ['affects'] },
  {
    id: 'drug_response',
    label: 'Drug response',
    rank: 7,
    terms: ['drug response', 'confers sensitivity', 'conferring sensitivity']
  },
  {
    id: 'other',
    label: 'Other',
    rank: 6,
    terms: [
      'other',
      'association not found',
      'oncogenic',
      'likely oncogenic',
      'tier i - strong',
      'tier ii - potential',
      'tier iii - uncertain significance',
      'tier iv - benign/likely benign'
    ]
  },
  { id: 'protective', label: 'Protective', rank: 5, terms: ['protective'] },
  { id: 'likely_benign', label: 'Likely benign', rank: 4, terms: ['likely benign'] },
  { id: 'benign_likely_benign', label: 'Benign/Likely benign', rank: 3, terms: [] },
  { id: 'benign', label: 'Benign', rank: 2, terms: ['benign'] },
  {
    id: 'not_provided',
    label: 'Not provided',
    rank: 1,
    terms: [
      'not provided',
      'no classification provided',
      'no classification for the single variant',
      'no classifications from unflagged records',
      'no interpretation for the single variant',
      'no assertion provided',
      '.',
      '-'
    ]
  }
] as const

export type ClinvarCategoryId = (typeof CLINVAR_CATEGORIES)[number]['id']

/**
 * Components that qualify a classification without being one. The comma split
 * separates them from their term ("Pathogenic, low penetrance").
 */
export const CLINVAR_MODIFIER_TERMS: readonly string[] = ['low penetrance']

/** Characters that separate the components of a multi-valued string. */
export const CLINVAR_COMPONENT_SEPARATOR = /[&/,|;]/

const RANK_BY_CATEGORY: Readonly<Record<string, number>> = Object.freeze(
  Object.fromEntries(CLINVAR_CATEGORIES.map(({ id, rank }) => [id, rank]))
)

const CATEGORY_BY_TERM: ReadonlyMap<string, ClinvarCategoryId> = new Map(
  CLINVAR_CATEGORIES.flatMap(({ id, terms }) =>
    (terms as readonly string[]).map((term): [string, ClinvarCategoryId] => [term, id])
  )
)

/** Lower case, underscores to spaces, typographic dashes to `-`, single spaces, trimmed. */
export function normalizeClinvarTerm(term: string): string {
  return term
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The recognised component categories of a raw string, without duplicates. */
function componentCategories(raw: string): Set<ClinvarCategoryId> {
  const found = new Set<ClinvarCategoryId>()
  // "Tier IV - Benign/Likely benign" contains a separator: try the whole first.
  const whole = CATEGORY_BY_TERM.get(normalizeClinvarTerm(raw))
  if (whole !== undefined) return found.add(whole)
  for (const part of raw.split(CLINVAR_COMPONENT_SEPARATOR)) {
    const term = normalizeClinvarTerm(part)
    if (term === '' || CLINVAR_MODIFIER_TERMS.includes(term)) continue
    const category = CATEGORY_BY_TERM.get(term)
    if (category !== undefined) found.add(category)
  }
  return found
}

/**
 * Category of a raw ClinVar significance string, or null when it is empty or
 * nothing in it is recognised.
 *
 * Multi-valued strings (`&`, `/`, `,`, `|`, `;`): the most severe component
 * wins, except that pathogenic with likely pathogenic, and benign with likely
 * benign when nothing is more severe, give ClinVar's aggregate category.
 */
export function clinvarCategory(raw: string | null | undefined): ClinvarCategoryId | null {
  if (raw === null || raw === undefined) return null
  const found = componentCategories(raw)
  if (found.size === 0) return null
  if (found.has('pathogenic_likely_pathogenic')) return 'pathogenic_likely_pathogenic'
  if (found.has('pathogenic') && found.has('likely_pathogenic')) {
    return 'pathogenic_likely_pathogenic'
  }
  let best: ClinvarCategoryId | null = null
  for (const category of found) {
    if (best === null || RANK_BY_CATEGORY[category] > RANK_BY_CATEGORY[best]) best = category
  }
  if (best === 'likely_benign' && found.has('benign')) return 'benign_likely_benign'
  return best
}

const CLINVAR_RANK_CACHE_LIMIT = 10_000
const clinvarRankCache = new Map<string, number>()

/** Stored rank of a raw ClinVar significance string, 0 when unknown. */
export function clinvarRank(raw: string | null | undefined): number {
  if (raw === null || raw === undefined) return UNKNOWN_SEVERITY_RANK
  const cached = clinvarRankCache.get(raw)
  if (cached !== undefined) return cached
  const category = clinvarCategory(raw)
  const rank = category === null ? UNKNOWN_SEVERITY_RANK : RANK_BY_CATEGORY[category]
  // An import sees a few hundred distinct strings; the cap only bounds abuse.
  if (clinvarRankCache.size >= CLINVAR_RANK_CACHE_LIMIT) clinvarRankCache.clear()
  clinvarRankCache.set(raw, rank)
  return rank
}

/** The two stored ranks of a variant row. */
export interface AnnotationSeverityRanks {
  impact_rank: number
  clinvar_rank: number
}

/** Ranks for the `consequence` (impact) and `clinvar` values of a variant row. */
export function annotationSeverityRanks(row: {
  consequence?: unknown
  clinvar?: unknown
}): AnnotationSeverityRanks {
  return {
    impact_rank: impactRank(typeof row.consequence === 'string' ? row.consequence : null),
    clinvar_rank: clinvarRank(typeof row.clinvar === 'string' ? row.clinvar : null)
  }
}
