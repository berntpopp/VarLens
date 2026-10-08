import {
  HET_GT_SQL as HET,
  HOM_GT_SQL as HOM,
  HOM_OR_HEMI_GT_SQL as HOM_OR_HEMI,
  notReferenceGtSql
} from '../../../shared/sql/genotype-dosage'
import type { VariantFilter } from '../../../shared/types/database'

export interface PostgresClinicalVariantFilterSqlContext {
  schemaName: string
  addParam: (value: unknown) => string
  addWhere: (sql: string) => void
}

export function addPostgresClinicalVariantFilters(
  filter: VariantFilter,
  context: PostgresClinicalVariantFilterSqlContext
): void {
  addTagFilter(filter, context)
  addPanelFilter(filter, context)
  addAnnotationFilters(filter, context)
  addInheritanceFilters(filter, context)
}

function addTagFilter(
  filter: VariantFilter,
  { schemaName, addParam, addWhere }: PostgresClinicalVariantFilterSqlContext
): void {
  if ((filter.tag_ids?.length ?? 0) === 0) return

  addWhere(`EXISTS (
          SELECT 1
          FROM ${schemaName}."variant_tags" vt
          WHERE vt.case_id = ${addParam(filter.case_id)}
            AND vt.variant_id = v.id
            AND vt.tag_id = ANY(${addParam(filter.tag_ids)}::bigint[])
        )`)
}

function addPanelFilter(
  filter: VariantFilter,
  { addParam, addWhere }: PostgresClinicalVariantFilterSqlContext
): void {
  if ((filter.panel_intervals?.length ?? 0) > 0) {
    const intervalClauses = filter.panel_intervals!.map((interval) => {
      const chr = addParam(interval.chr)
      const start = addParam(interval.start)
      const end = addParam(interval.end)
      return `(v.chr = ${chr} AND v.pos <= ${end} AND COALESCE(v.end_pos, v.pos) >= ${start})`
    })
    addWhere(`(${intervalClauses.join(' OR ')})`)
    return
  }

  // An unresolved panel request must never reach SQL. There is deliberately no
  // gene-symbol fallback: it ignored padding and genome build and dropped
  // variants the SQLite backend keeps (issue #447). Callers resolve
  // `active_panel_ids` into `panel_intervals` through
  // PostgresPanelIntervalResolver before building the query.
  if ((filter.active_panel_ids?.length ?? 0) > 0) {
    throw new Error(
      'Active gene panel filter was not resolved to genomic intervals before building the PostgreSQL variant query'
    )
  }
}

function addAnnotationFilters(
  filter: VariantFilter,
  context: PostgresClinicalVariantFilterSqlContext
): void {
  if (filter.starred_only === true) {
    addAnnotationPredicate(
      filter,
      context,
      "cva.starred::text IN ('1', 'true', 't')",
      "va.starred::text IN ('1', 'true', 't')"
    )
  }

  if (filter.has_comment === true) {
    addAnnotationPredicate(
      filter,
      context,
      "NULLIF(cva.per_case_comment, '') IS NOT NULL",
      "NULLIF(va.global_comment, '') IS NOT NULL"
    )
  }

  if ((filter.acmg_classifications?.length ?? 0) > 0) {
    const acmgParam = context.addParam(filter.acmg_classifications)
    addAnnotationPredicate(
      filter,
      context,
      `cva.acmg_classification = ANY(${acmgParam}::text[])`,
      `va.acmg_classification = ANY(${acmgParam}::text[])`
    )
  }
}

function addAnnotationPredicate(
  filter: VariantFilter,
  { schemaName, addParam, addWhere }: PostgresClinicalVariantFilterSqlContext,
  casePredicate: string,
  globalPredicate: string
): void {
  const caseExists = `EXISTS (
          SELECT 1
          FROM ${schemaName}."case_variant_annotations" cva
          WHERE cva.case_id = ${addParam(filter.case_id)}
            AND cva.variant_id = v.id
            AND ${casePredicate}
        )`

  if (filter.annotation_scope !== 'all') {
    addWhere(caseExists)
    return
  }

  addWhere(`(${caseExists}
        OR EXISTS (
          SELECT 1
          FROM ${schemaName}."variant_annotations" va
          WHERE va.chr = v.chr
            AND va.pos = v.pos
            AND va.ref = v.ref
            AND va.alt = v.alt
            AND ${globalPredicate}
        ))`)
}

function addInheritanceFilters(
  filter: VariantFilter,
  { schemaName, addParam, addWhere }: PostgresClinicalVariantFilterSqlContext
): void {
  const modes = filter.inheritance_modes
  if (modes === undefined || modes.length === 0) return

  const conditions: string[] = []

  if (modes.includes('homozygous')) {
    conditions.push(`v.gt_num IN ${HOM}`)
  }
  if (modes.includes('heterozygous')) {
    conditions.push(`v.gt_num IN ${HET}`)
  }
  if (modes.includes('x_hemizygous')) {
    conditions.push(`(v.chr IN ('X', 'chrX') AND v.gt_num IN ${HOM_OR_HEMI})`)
  }
  if (modes.includes('candidate_compound_het')) {
    const caseParam = addParam(filter.case_id)
    conditions.push(`(v.gene_symbol IN (
            SELECT v2.gene_symbol
            FROM ${schemaName}."variants" v2
            WHERE v2.case_id = ${caseParam}
              AND v2.gt_num IN ${HET}
              AND v2.gene_symbol IS NOT NULL
            GROUP BY v2.gene_symbol
            HAVING COUNT(*) >= 2
          ) AND v.gt_num IN ${HET})`)
  }

  if (filter.analysis_group_id !== undefined) {
    const caseParam = addParam(filter.case_id)
    const groupParam = addParam(filter.analysis_group_id)
    addTrioInheritanceFilters(modes, conditions, schemaName, caseParam, groupParam)
  }

  if (conditions.length === 0) return

  addWhere(`(${conditions.join('\n          OR ')})`)
}

function addTrioInheritanceFilters(
  modes: string[],
  conditions: string[],
  schemaName: string,
  caseParam: string,
  groupParam: string
): void {
  if (modes.includes('de_novo')) {
    conditions.push(`(
            v.gt_num IN ${HET}
            AND v.id NOT IN (
              SELECT p.id
              FROM ${schemaName}."variants" p
              INNER JOIN ${schemaName}."analysis_group_members" agm_f
                ON agm_f.group_id = ${groupParam}
               AND agm_f.role = 'father'
              INNER JOIN ${schemaName}."variants" f
                ON f.case_id = agm_f.case_id
               AND f.chr = p.chr
               AND f.pos = p.pos
               AND f.ref = p.ref
               AND f.alt = p.alt
               AND ${notReferenceGtSql('f.gt_num')}
              WHERE p.case_id = ${caseParam}
            )
            AND v.id NOT IN (
              SELECT p.id
              FROM ${schemaName}."variants" p
              INNER JOIN ${schemaName}."analysis_group_members" agm_m
                ON agm_m.group_id = ${groupParam}
               AND agm_m.role = 'mother'
              INNER JOIN ${schemaName}."variants" m
                ON m.case_id = agm_m.case_id
               AND m.chr = p.chr
               AND m.pos = p.pos
               AND m.ref = p.ref
               AND m.alt = p.alt
               AND ${notReferenceGtSql('m.gt_num')}
              WHERE p.case_id = ${caseParam}
            )
          )`)
  }

  if (modes.includes('autosomal_recessive')) {
    conditions.push(`(
            v.gt_num IN ${HOM}
            AND v.id NOT IN (
              SELECT p.id
              FROM ${schemaName}."variants" p
              INNER JOIN ${schemaName}."analysis_group_members" agm_par
                ON agm_par.group_id = ${groupParam}
               AND agm_par.role IN ('father', 'mother')
              INNER JOIN ${schemaName}."variants" par
                ON par.case_id = agm_par.case_id
               AND par.chr = p.chr
               AND par.pos = p.pos
               AND par.ref = p.ref
               AND par.alt = p.alt
               AND par.gt_num IN ${HOM}
              WHERE p.case_id = ${caseParam}
            )
          )`)
  }

  if (modes.includes('compound_het')) {
    conditions.push(`(
            v.gt_num IN ${HET}
            AND v.gene_symbol IS NOT NULL
            AND v.gene_symbol IN (
              SELECT v_inner.gene_symbol
              FROM ${schemaName}."variants" v_inner
              WHERE v_inner.case_id = ${caseParam}
                AND v_inner.gt_num IN ${HET}
                AND v_inner.gene_symbol IS NOT NULL
              GROUP BY v_inner.gene_symbol
              HAVING COUNT(*) >= 2
            )
            AND v.gene_symbol IN (
              SELECT pf.gene_symbol
              FROM ${schemaName}."variants" pf
              INNER JOIN ${schemaName}."analysis_group_members" agm_f
                ON agm_f.group_id = ${groupParam}
               AND agm_f.role = 'father'
              INNER JOIN ${schemaName}."variants" f
                ON f.case_id = agm_f.case_id
               AND f.chr = pf.chr
               AND f.pos = pf.pos
               AND f.ref = pf.ref
               AND f.alt = pf.alt
               AND f.gt_num IN ${HET}
              INNER JOIN ${schemaName}."variants" pm
                ON pm.case_id = ${caseParam}
               AND pm.gene_symbol = pf.gene_symbol
               AND pm.gt_num IN ${HET}
               AND (pm.chr != pf.chr OR pm.pos != pf.pos OR pm.ref != pf.ref OR pm.alt != pf.alt)
              INNER JOIN ${schemaName}."analysis_group_members" agm_m
                ON agm_m.group_id = ${groupParam}
               AND agm_m.role = 'mother'
              INNER JOIN ${schemaName}."variants" m
                ON m.case_id = agm_m.case_id
               AND m.chr = pm.chr
               AND m.pos = pm.pos
               AND m.ref = pm.ref
               AND m.alt = pm.alt
               AND m.gt_num IN ${HET}
              WHERE pf.case_id = ${caseParam}
                AND pf.gt_num IN ${HET}
                AND pf.gene_symbol IS NOT NULL
            )
          )`)
  }
}
