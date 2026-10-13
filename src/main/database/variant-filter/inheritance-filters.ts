import { sql, type RawBuilder } from 'kysely'
import type { VariantFilter } from '../types'
import type { VariantQueryBuilder } from './query-types'
import {
  HET_GT_SQL,
  HET_OR_HEMI_GT_SQL,
  HOM_GT_SQL,
  notReferenceGtSql
} from '../../../shared/sql/genotype-dosage'
import {
  autosomalRecessiveSql,
  candidateCompoundHetSql,
  compoundHetPairIdsSql,
  QUALIFYING_ROW_COLUMNS,
  xHemizygousSql,
  type TrioSqlContext
} from '../../../shared/sql/inheritance-sql'
import { isTrioMode } from '../../../shared/types/inheritance'

// The shared genotype classes (src/shared/utils/genotype.ts), inlined as literals.
const HET = sql.raw(HET_GT_SQL)
const HOM = sql.raw(HOM_GT_SQL)
const HET_OR_HEMI = sql.raw(HET_OR_HEMI_GT_SQL)
const MALE_X_HEMIZYGOUS = sql.raw(xHemizygousSql('variants', 'case_metadata', true))
const PARENT_NOT_REFERENCE = sql.raw(notReferenceGtSql('f.gt_num'))

const CASE_MARK = '@case@'
const GROUP_MARK = '@group@'
const QUALIFYING_MARK = '@qualifying@'
const TRIO_CONTEXT: TrioSqlContext = {
  variants: 'variants',
  members: 'analysis_group_members',
  caseParam: CASE_MARK,
  groupParam: GROUP_MARK
}

/** Shared SQL text with its case and group markers bound as parameters. */
function bound(text: string, caseId: number, groupId: number): SqlCondition {
  const parts = text.split(/(@case@|@group@)/).map((part) => {
    if (part === CASE_MARK) return sql`${caseId}`
    return part === GROUP_MARK ? sql`${groupId}` : sql.raw(part)
  })
  return sql.join(parts, sql.raw(''))
}

/**
 * Inheritance-mode predicates for the case variant query.
 *
 * NOTE: `filter.consider_phasing` is accepted but not yet implemented.
 * Phasing-aware compound het detection (distinguishing 0|1 from 1|0)
 * will be added when long-read phased VCF import is supported.
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
function deNovoCondition(cid: number, gid: number): SqlCondition {
  // A male chrX call written diploid (1/1) is one copy too.
  return sql`(
            (variants.gt_num IN ${HET_OR_HEMI} OR ${MALE_X_HEMIZYGOUS})
            AND variants.id NOT IN (
              SELECT p.id FROM variants p
              INNER JOIN analysis_group_members agm_f
                ON agm_f.group_id = ${gid} AND agm_f.role = 'father'
              INNER JOIN variants f
                ON f.case_id = agm_f.case_id
                AND f.chr = p.chr AND f.pos = p.pos AND f.ref = p.ref AND f.alt = p.alt
                AND ${PARENT_NOT_REFERENCE}
              WHERE p.case_id = ${cid}
            )
            AND variants.id NOT IN (
              SELECT p.id FROM variants p
              INNER JOIN analysis_group_members agm_m
                ON agm_m.group_id = ${gid} AND agm_m.role = 'mother'
              INNER JOIN variants f
                ON f.case_id = agm_m.case_id
                AND f.chr = p.chr AND f.pos = p.pos AND f.ref = p.ref AND f.alt = p.alt
                AND ${PARENT_NOT_REFERENCE}
              WHERE p.case_id = ${cid}
            )
          )`
}

/** Proband hom and every parent of the group a het carrier (inheritance-sql.ts). */
function autosomalRecessiveCondition(cid: number, gid: number): SqlCondition {
  return bound(autosomalRecessiveSql(TRIO_CONTEXT, 'variants'), cid, gid)
}

/** Het variants of a pair inherited from opposite parents (inheritance-sql.ts). */
function compoundHetCondition(cid: number, gid: number): SqlCondition {
  return sql`(variants.id IN (${bound(compoundHetPairIdsSql(TRIO_CONTEXT), cid, gid)}))`
}

/** Trio modes — require an analysis group (father/mother members). */
function buildTrioConditions(modes: string[], caseId: number, groupId: number): SqlCondition[] {
  const conditions: SqlCondition[] = []
  if (modes.includes('de_novo')) conditions.push(deNovoCondition(caseId, groupId))
  if (modes.includes('autosomal_recessive')) {
    conditions.push(autosomalRecessiveCondition(caseId, groupId))
  }
  if (modes.includes('compound_het')) conditions.push(compoundHetCondition(caseId, groupId))
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
    conditions.push(...buildTrioConditions(modes, filter.case_id, groupId))
  } else if (modes.some(isTrioMode)) {
    conditions.push(sql`FALSE`)
  }
  return whereAnyCondition(query, conditions)
}
