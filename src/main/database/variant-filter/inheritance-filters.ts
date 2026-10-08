import { sql, type RawBuilder } from 'kysely'
import type { VariantFilter } from '../types'
import type { VariantQueryBuilder } from './query-types'
import {
  HET_GT_SQL,
  HOM_GT_SQL,
  HOM_OR_HEMI_GT_SQL,
  notReferenceGtSql
} from '../../../shared/sql/genotype-dosage'

// The shared genotype classes (src/shared/utils/genotype.ts), inlined as literals.
const HET = sql.raw(HET_GT_SQL)
const HOM = sql.raw(HOM_GT_SQL)
const HOM_OR_HEMI = sql.raw(HOM_OR_HEMI_GT_SQL)
const PARENT_NOT_REFERENCE = sql.raw(notReferenceGtSql('f.gt_num'))

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

/** Het in the proband with at least two het variants in the same gene. */
function candidateCompoundHetCondition(cid: number): SqlCondition {
  return sql`(variants.gene_symbol IN (
            SELECT v2.gene_symbol FROM variants v2
            WHERE v2.case_id = ${cid}
              AND v2.gt_num IN ${HET}
              AND v2.gene_symbol IS NOT NULL
            GROUP BY v2.gene_symbol HAVING COUNT(*) >= 2
          ) AND variants.gt_num IN ${HET})`
}

/** Solo modes — always available, no family data required. */
function buildSoloConditions(modes: string[], caseId: number): SqlCondition[] {
  const conditions: SqlCondition[] = []
  if (modes.includes('homozygous')) {
    conditions.push(sql`variants.gt_num IN ${HOM}`)
  }
  if (modes.includes('heterozygous')) {
    conditions.push(sql`variants.gt_num IN ${HET}`)
  }
  if (modes.includes('x_hemizygous')) {
    conditions.push(sql`(variants.chr IN ('X', 'chrX') AND variants.gt_num IN ${HOM_OR_HEMI})`)
  }
  if (modes.includes('candidate_compound_het')) {
    conditions.push(candidateCompoundHetCondition(caseId))
  }
  return conditions
}

/** Het in proband; neither parent has a row there other than an explicit reference call. */
function deNovoCondition(cid: number, gid: number): SqlCondition {
  return sql`(
            variants.gt_num IN ${HET}
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

/** Proband hom, parents NOT hom (must be het carriers or absent). */
function autosomalRecessiveCondition(cid: number, gid: number): SqlCondition {
  return sql`(
            variants.gt_num IN ${HOM}
            AND variants.id NOT IN (
              SELECT p.id FROM variants p
              INNER JOIN analysis_group_members agm_par
                ON agm_par.group_id = ${gid} AND agm_par.role IN ('father', 'mother')
              INNER JOIN variants par
                ON par.case_id = agm_par.case_id
                AND par.chr = p.chr AND par.pos = p.pos AND par.ref = p.ref AND par.alt = p.alt
                AND par.gt_num IN ${HOM}
              WHERE p.case_id = ${cid}
            )
          )`
}

/**
 * Het variants in genes where:
 * 1. Gene has >= 2 distinct het variants in proband
 * 2. At least one variant is shared with father
 * 3. At least one DIFFERENT variant is shared with mother
 */
function compoundHetCondition(cid: number, gid: number): SqlCondition {
  return sql`(
            variants.gt_num IN ${HET}
            AND variants.gene_symbol IS NOT NULL
            AND variants.gene_symbol IN (
              SELECT v_inner.gene_symbol
              FROM variants v_inner
              WHERE v_inner.case_id = ${cid}
                AND v_inner.gt_num IN ${HET}
                AND v_inner.gene_symbol IS NOT NULL
              GROUP BY v_inner.gene_symbol HAVING COUNT(*) >= 2
            )
            AND variants.gene_symbol IN (
              SELECT pf.gene_symbol
              FROM variants pf
              INNER JOIN analysis_group_members agm_f
                ON agm_f.group_id = ${gid} AND agm_f.role = 'father'
              INNER JOIN variants f ON f.case_id = agm_f.case_id
                AND f.chr = pf.chr AND f.pos = pf.pos AND f.ref = pf.ref AND f.alt = pf.alt
                AND f.gt_num IN ${HET}
              INNER JOIN variants pm
                ON pm.case_id = ${cid}
                AND pm.gene_symbol = pf.gene_symbol
                AND pm.gt_num IN ${HET}
                AND (pm.chr != pf.chr OR pm.pos != pf.pos OR pm.ref != pf.ref OR pm.alt != pf.alt)
              INNER JOIN analysis_group_members agm_m
                ON agm_m.group_id = ${gid} AND agm_m.role = 'mother'
              INNER JOIN variants m ON m.case_id = agm_m.case_id
                AND m.chr = pm.chr AND m.pos = pm.pos AND m.ref = pm.ref AND m.alt = pm.alt
                AND m.gt_num IN ${HET}
              WHERE pf.case_id = ${cid}
                AND pf.gt_num IN ${HET}
                AND pf.gene_symbol IS NOT NULL
            )
          )`
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
 * NOTE: If only trio modes are selected without an analysis group, no
 * condition is produced and no inheritance filter is applied. The UI
 * prevents this by disabling trio chips when no group is set.
 */
export function applyInheritanceFilters(
  query: VariantQueryBuilder,
  filter: VariantFilter
): VariantQueryBuilder {
  if (!filter.inheritance_modes || filter.inheritance_modes.length === 0) return query
  const modes = filter.inheritance_modes
  const groupId = filter.analysis_group_id ?? null
  const conditions = buildSoloConditions(modes, filter.case_id)
  if (groupId !== null) conditions.push(...buildTrioConditions(modes, filter.case_id, groupId))
  return whereAnyCondition(query, conditions)
}
