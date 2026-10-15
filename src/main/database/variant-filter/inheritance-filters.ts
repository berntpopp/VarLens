import { sql, type RawBuilder } from 'kysely'
import type { VariantFilter } from '../types'
import type { VariantQueryBuilder } from './query-types'
import { HET_GT_SQL, HOM_GT_SQL } from '../../../shared/sql/genotype-dosage'
import {
  autosomalDominantSql,
  autosomalRecessiveSql,
  candidateCompoundHetSql,
  compoundHetPairIdsSql,
  deNovoSql,
  QUALIFYING_ROW_COLUMNS,
  xDominantSql,
  xHemizygousSql,
  xRecessiveSql,
  type DeNovoQualityThresholds,
  type TrioSqlContext
} from '../../../shared/sql/inheritance-sql'
import { isTrioMode } from '../../../shared/types/inheritance'

// The shared genotype classes (src/shared/utils/genotype.ts), inlined as literals.
const HET = sql.raw(HET_GT_SQL)
const HOM = sql.raw(HOM_GT_SQL)

const CASE_MARK = '@case@'
const GROUP_MARK = '@group@'
const QUALIFYING_MARK = '@qualifying@'
const DN_MIN_GQ_MARK = '@dn_min_gq@'
const DN_MIN_DP_MARK = '@dn_min_dp@'
const DN_MIN_AB_MARK = '@dn_min_ab@'
const DN_MAX_PARENT_AB_MARK = '@dn_max_parent_ab@'
const MARK_SPLIT = /(@case@|@group@|@dn_min_gq@|@dn_min_dp@|@dn_min_ab@|@dn_max_parent_ab@)/

const TRIO_CONTEXT: TrioSqlContext = {
  variants: 'variants',
  members: 'analysis_group_members',
  cases: 'cases',
  caseMetadata: 'case_metadata',
  caseParam: CASE_MARK,
  groupParam: GROUP_MARK
}

/** Shared SQL text with its case, group, and quality markers bound as parameters. */
function bound(
  text: string,
  caseId: number,
  groupId: number,
  filter?: VariantFilter
): SqlCondition {
  const parts = text.split(MARK_SPLIT).map((part) => {
    if (part === CASE_MARK) return sql`${caseId}`
    if (part === GROUP_MARK) return sql`${groupId}`
    if (part === DN_MIN_GQ_MARK) return sql`${filter?.de_novo_min_gq}`
    if (part === DN_MIN_DP_MARK) return sql`${filter?.de_novo_min_dp}`
    if (part === DN_MIN_AB_MARK) return sql`${filter?.de_novo_min_ab}`
    if (part === DN_MAX_PARENT_AB_MARK) return sql`${filter?.de_novo_max_parent_ab}`
    return sql.raw(part)
  })
  return sql.join(parts, sql.raw(''))
}

/**
 * Inheritance-mode predicates for the case variant query.
 *
 * `filter.consider_phasing` never changes which rows match (#586): a pair
 * proven in cis by a shared phase set (src/shared/utils/phasing.ts) is
 * labelled, not excluded. The label is shown where a compound het is
 * explained — the evidence shortlist (`rank_comphet_phase`). Trio
 * compound het already proves trans from the parents.
 *
 * The SQL fragments below are emitted verbatim (including their internal
 * whitespace), so the multi-line template literals deliberately keep the
 * indentation they had before the `build()` split — do not re-indent them.
 */

type SqlCondition = RawBuilder<unknown>

/**
 * Het, with a second distinct het variant in the gene among the rows that pass
 * every other active filter: `qualifying` is the query before this step (#579).
 */
function candidateCompoundHetCondition(qualifying: VariantQueryBuilder): SqlCondition {
  const rows = qualifying
    .clearSelect()
    .select(QUALIFYING_ROW_COLUMNS.map((column) => `variants.${column}` as const))
  const [before, after] = candidateCompoundHetSql('variants', QUALIFYING_MARK).split(
    QUALIFYING_MARK
  )
  return sql`${sql.raw(before)}(${rows})${sql.raw(after)}`
}

/** Solo modes — always available, no family data required. */
function buildSoloConditions(modes: string[], qualifying: VariantQueryBuilder): SqlCondition[] {
  const conditions: SqlCondition[] = []
  if (modes.includes('homozygous')) {
    conditions.push(sql`variants.gt_num IN ${HOM}`)
  }
  if (modes.includes('heterozygous')) {
    conditions.push(sql`variants.gt_num IN ${HET}`)
  }
  if (modes.includes('x_hemizygous')) {
    conditions.push(sql.raw(xHemizygousSql('variants', 'case_metadata')))
  }
  if (modes.includes('candidate_compound_het')) {
    conditions.push(candidateCompoundHetCondition(qualifying))
  }
  return conditions
}

/** One copy in the proband; neither parent has a row there other than an explicit reference call. */
function deNovoCondition(filter: VariantFilter, gid: number): SqlCondition {
  const thresholds: DeNovoQualityThresholds = {
    minGq: filter.de_novo_min_gq !== undefined ? DN_MIN_GQ_MARK : undefined,
    minDp: filter.de_novo_min_dp !== undefined ? DN_MIN_DP_MARK : undefined,
    minProbandAb: filter.de_novo_min_ab !== undefined ? DN_MIN_AB_MARK : undefined,
    maxParentAb: filter.de_novo_max_parent_ab !== undefined ? DN_MAX_PARENT_AB_MARK : undefined
  }
  return bound(deNovoSql(TRIO_CONTEXT, 'variants', thresholds), filter.case_id, gid, filter)
}

/** Proband hom and every parent of the group a het carrier (inheritance-sql.ts). */
function autosomalRecessiveCondition(cid: number, gid: number): SqlCondition {
  return bound(autosomalRecessiveSql(TRIO_CONTEXT, 'variants'), cid, gid)
}

/** Het variants of a pair inherited from opposite parents (inheritance-sql.ts). */
function compoundHetCondition(cid: number, gid: number): SqlCondition {
  return sql`(variants.id IN (${bound(compoundHetPairIdsSql(TRIO_CONTEXT), cid, gid)}))`
}

/** Trio modes — require an analysis group (father/mother/relative members). */
function buildTrioConditions(
  modes: string[],
  filter: VariantFilter,
  groupId: number
): SqlCondition[] {
  const caseId = filter.case_id
  const conditions: SqlCondition[] = []
  if (modes.includes('de_novo')) conditions.push(deNovoCondition(filter, groupId))
  if (modes.includes('autosomal_recessive')) {
    conditions.push(autosomalRecessiveCondition(caseId, groupId))
  }
  if (modes.includes('compound_het')) conditions.push(compoundHetCondition(caseId, groupId))
  if (modes.includes('autosomal_dominant')) {
    conditions.push(bound(autosomalDominantSql(TRIO_CONTEXT, 'variants'), caseId, groupId))
  }
  if (modes.includes('x_recessive')) {
    conditions.push(bound(xRecessiveSql(TRIO_CONTEXT, 'variants'), caseId, groupId))
  }
  if (modes.includes('x_dominant')) {
    conditions.push(bound(xDominantSql(TRIO_CONTEXT, 'variants'), caseId, groupId))
  }
  return conditions
}

/** Combine conditions with OR inside one parenthesised group. */
function whereAnyCondition(
  query: VariantQueryBuilder,
  conditions: SqlCondition[]
): VariantQueryBuilder {
  if (conditions.length === 0) return query
  if (conditions.length === 1) return query.where(sql<boolean>`(${conditions[0]})`)
  let combined = conditions[0]
  for (let i = 1; i < conditions.length; i++) {
    combined = sql`${combined} OR ${conditions[i]}`
  }
  return query.where(sql<boolean>`(${combined})`)
}

/**
 * Apply the selected inheritance modes as one OR group.
 *
 * A trio mode without an analysis group cannot be evaluated, so it matches no
 * row (fail closed, #553): a stored shortlist or export filter that kept a
 * trio mode after its family was cleared must never fall back to unfiltered.
 */
export function applyInheritanceFilters(
  query: VariantQueryBuilder,
  filter: VariantFilter
): VariantQueryBuilder {
  if (!filter.inheritance_modes || filter.inheritance_modes.length === 0) return query
  const modes = filter.inheritance_modes
  const groupId = filter.analysis_group_id ?? null
  const conditions = buildSoloConditions(modes, query)
  if (groupId !== null) {
    conditions.push(...buildTrioConditions(modes, filter, groupId))
  } else if (modes.some(isTrioMode)) {
    conditions.push(sql`FALSE`)
  }
  return whereAnyCondition(query, conditions)
}
