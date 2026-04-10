import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { sql, type Kysely, type SelectQueryBuilder } from 'kysely'
import type { VarlensDatabase } from '../../shared/types/database-schema'
import type { Variant, VariantFilter, SortItem } from './types'
import { mainLogger } from '../services/MainLogger'
import type { VariantSearchService } from './VariantSearchService'

/**
 * Kysely query builder type for variant queries.
 * Uses `any` for the table union to accommodate the LEFT JOIN alias ('vf')
 * and the computed `internal_af` column which isn't in any physical table schema.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type VariantQueryBuilder = SelectQueryBuilder<VarlensDatabase, any, Record<string, unknown>>

export const SORTABLE_COLUMNS: Record<string, string> = {
  chr: 'chr',
  pos: 'pos',
  gene_symbol: 'gene_symbol',
  omim_mim_number: 'omim_mim_number',
  func: 'func',
  consequence: 'consequence',
  transcript: 'transcript',
  cdna: 'cdna',
  aa_change: 'aa_change',
  gt_num: 'gt_num',
  gnomad_af: 'gnomad_af',
  cadd: 'cadd',
  qual: 'qual',
  hpo_sim_score: 'hpo_sim_score',
  clinvar: 'clinvar',
  moi: 'moi'
}

/**
 * Builds WHERE clause and ORDER BY for variant queries.
 *
 * Extracted from VariantRepository to isolate the complex filter/sort logic
 * (~430 lines) into a focused, independently testable module.
 */
export class VariantFilterBuilder {
  constructor(
    private readonly db: DatabaseType,
    private readonly kysely: Kysely<VarlensDatabase>,
    private readonly searchService?: VariantSearchService
  ) {}

  /**
   * Build a Kysely SELECT query from a VariantFilter.
   * Used by both getVariants() and getAllVariantsForExport().
   */
  build(filter: VariantFilter, options?: { forceOrChain?: boolean }): VariantQueryBuilder {
    let query: VariantQueryBuilder = this.kysely
      .selectFrom('variants')
      .selectAll('variants')
      .leftJoin('variant_frequency as vf', (join) =>
        join
          .onRef('vf.chr', '=', 'variants.chr')
          .onRef('vf.pos', '=', 'variants.pos')
          .onRef('vf.ref', '=', 'variants.ref')
          .onRef('vf.alt', '=', 'variants.alt')
      )
      .select(
        sql<
          number | null
        >`CAST(vf.case_count AS REAL) / NULLIF((SELECT COUNT(*) FROM cases), 0)`.as('internal_af')
      )
      .where('variants.case_id', '=', filter.case_id)

    // Pre-compute case count to avoid per-row subquery in internal AF filter
    let totalCaseCount: number | undefined
    if (filter.max_internal_af !== undefined && filter.max_internal_af > 0) {
      const compiled = this.kysely
        .selectFrom('cases')
        .select(this.kysely.fn.countAll<number>().as('cnt'))
        .compile()
      const countResult = this.db.prepare(compiled.sql).get(...compiled.parameters) as
        | { cnt: number }
        | undefined
      totalCaseCount = countResult?.cnt ?? 0
    }

    // Variant type filter (snv includes both snv and indel)
    query = query.$if(filter.variant_type !== undefined && filter.variant_type !== '', (qb) => {
      if (filter.variant_type === 'snv') {
        return qb.where((eb) =>
          eb.or([
            eb('variants.variant_type', '=', 'snv'),
            eb('variants.variant_type', '=', 'indel')
          ])
        )
      }
      return qb.where('variants.variant_type', '=', filter.variant_type!)
    })

    // Extension table JOINs for type-specific queries
    if (filter.variant_type === 'sv') {
      query = query
        .leftJoin('variant_sv as sv', 'sv.variant_id', 'variants.id')
        .select([
          'sv.support as _sv_support',
          'sv.dr as _sv_dr',
          'sv.dv as _sv_dv',
          'sv.vaf as _sv_vaf',
          'sv.sv_is_precise as _sv_is_precise',
          'sv.strand as _sv_strand',
          'sv.coverage as _sv_coverage',
          'sv.stdev_len as _sv_stdev_len',
          'sv.stdev_pos as _sv_stdev_pos'
        ])
    } else if (filter.variant_type === 'cnv') {
      query = query
        .leftJoin('variant_cnv as cnv', 'cnv.variant_id', 'variants.id')
        .select([
          'cnv.copy_number as _cnv_copy_number',
          'cnv.copy_number_quality as _cnv_gq',
          'cnv.homozygosity_ref as _cnv_ho_ref',
          'cnv.homozygosity_alt as _cnv_ho_alt'
        ])
    } else if (filter.variant_type === 'str') {
      query = query
        .leftJoin('variant_str as str_ext', 'str_ext.variant_id', 'variants.id')
        .select([
          'str_ext.repeat_id as _str_repeat_id',
          'str_ext.repeat_unit as _str_repeat_unit',
          'str_ext.display_repeat_unit as _str_display_ru',
          'str_ext.ref_copies as _str_ref_copies',
          'str_ext.alt_copies as _str_alt_copies',
          'str_ext.str_status as _str_status',
          'str_ext.normal_max as _str_normal_max',
          'str_ext.pathologic_min as _str_pathologic_min',
          'str_ext.disease as _str_disease',
          'str_ext.inheritance_mode as _str_inheritance_mode',
          'str_ext.rank_score as _str_rank_score'
        ])
    }

    // Simple filters via $if
    query = query.$if(filter.gene_symbol !== undefined && filter.gene_symbol !== '', (qb) =>
      qb.where('gene_symbol', 'like', `%${filter.gene_symbol}%`)
    )

    // consequence vs consequences — mutually exclusive
    query = query.$if((filter.consequences?.length ?? 0) > 0, (qb) =>
      qb.where('consequence', 'in', filter.consequences!)
    )
    query = query.$if(
      (filter.consequences === undefined || filter.consequences.length === 0) &&
        filter.consequence !== undefined &&
        filter.consequence !== '',
      (qb) => qb.where('consequence', '=', filter.consequence!)
    )

    // Array filters
    query = query
      .$if((filter.funcs?.length ?? 0) > 0, (qb) => qb.where('func', 'in', filter.funcs!))
      .$if((filter.clinvars?.length ?? 0) > 0, (qb) => qb.where('clinvar', 'in', filter.clinvars!))

    // Range filters with NULL handling
    query = query
      .$if(filter.gnomad_af_max !== undefined, (qb) =>
        qb.where(({ or, eb }) =>
          or([eb('gnomad_af', 'is', null), eb('gnomad_af', '<=', filter.gnomad_af_max!)])
        )
      )
      .$if(filter.cadd_min !== undefined, (qb) =>
        qb.where(({ or, eb }) => or([eb('cadd', 'is', null), eb('cadd', '>=', filter.cadd_min!)]))
      )

    // Internal AF filter (NULL-inclusive: variants without frequency data pass)
    query = query.$if(
      filter.max_internal_af !== undefined &&
        filter.max_internal_af > 0 &&
        totalCaseCount !== undefined &&
        totalCaseCount > 0,
      (qb) =>
        qb.where(({ or, eb }) =>
          or([
            eb(sql.ref('vf.case_count'), 'is', null),
            eb(
              sql<number>`CAST(vf.case_count AS REAL) / ${totalCaseCount!}`,
              '<=',
              filter.max_internal_af!
            )
          ])
        )
    )

    // FTS5 search
    if (filter.search_query != null && filter.search_query !== '') {
      if (this.searchService) {
        query = this.searchService.applySearchFilter(query, filter.search_query)
      }
    }

    // Exact variant match (table-qualified to avoid ambiguity with LEFT JOIN)
    query = query
      .$if(filter.chr != null && filter.chr !== '', (qb) =>
        qb.where('variants.chr', '=', filter.chr!)
      )
      .$if(filter.pos != null, (qb) => qb.where('variants.pos', '=', filter.pos!))
      .$if(filter.ref != null && filter.ref !== '', (qb) =>
        qb.where('variants.ref', '=', filter.ref!)
      )
      .$if(filter.alt != null && filter.alt !== '', (qb) =>
        qb.where('variants.alt', '=', filter.alt!)
      )

    // Tag filter
    query = query.$if((filter.tag_ids?.length ?? 0) > 0, (qb) =>
      qb.where(
        'id',
        'in',
        this.kysely
          .selectFrom('variant_tags')
          .select('variant_id')
          .where('case_id', '=', filter.case_id)
          .where('tag_id', 'in', filter.tag_ids!)
      )
    )

    // Panel genomic interval filter
    if (filter.panel_intervals && filter.panel_intervals.length > 0) {
      if (filter.panel_intervals.length < 50 || options?.forceOrChain === true) {
        // Small set (or forced for compiled queries): OR chain of chr + pos range conditions
        const intervals = filter.panel_intervals
        query = query.where(({ or, and, eb }) =>
          or(
            intervals.map((iv) =>
              and([eb('chr', '=', iv.chr), eb('pos', '>=', iv.start), eb('pos', '<=', iv.end)])
            )
          )
        )
      } else {
        // Large set: use pre-populated temp table (preparePanelIntervals must be called first)
        query = query.where(
          sql<boolean>`EXISTS (SELECT 1 FROM _panel_intervals pi WHERE variants.chr = pi.chr AND variants.pos BETWEEN pi.start_pos AND pi.end_pos)`
        )
      }
    }

    // Starred filter (scope-dependent)
    query = query.$if(filter.starred_only === true, (qb) => {
      if (filter.annotation_scope === 'all') {
        return qb.where(({ selectFrom, eb }) =>
          eb(
            'id',
            'in',
            selectFrom('case_variant_annotations')
              .select('variant_id')
              .where('case_id', '=', filter.case_id)
              .where('starred', '=', 1)
              .union(
                selectFrom('variants as v2')
                  .select('v2.id as variant_id')
                  .innerJoin('variant_annotations as va', (join) =>
                    join
                      .onRef('va.chr', '=', 'v2.chr')
                      .onRef('va.pos', '=', 'v2.pos')
                      .onRef('va.ref', '=', 'v2.ref')
                      .onRef('va.alt', '=', 'v2.alt')
                  )
                  .where('va.starred', '=', 1)
                  .where('v2.case_id', '=', filter.case_id)
              )
          )
        )
      }
      return qb.where(
        'id',
        'in',
        this.kysely
          .selectFrom('case_variant_annotations')
          .select('variant_id')
          .where('case_id', '=', filter.case_id)
          .where('starred', '=', 1)
      )
    })

    // Comment filter (scope-dependent)
    query = query.$if(filter.has_comment === true, (qb) => {
      if (filter.annotation_scope === 'all') {
        return qb.where(({ selectFrom, eb }) =>
          eb(
            'id',
            'in',
            selectFrom('case_variant_annotations')
              .select('variant_id')
              .where('case_id', '=', filter.case_id)
              .where('per_case_comment', 'is not', null)
              .where('per_case_comment', '!=', '')
              .union(
                selectFrom('variants as v2')
                  .select('v2.id as variant_id')
                  .innerJoin('variant_annotations as va', (join) =>
                    join
                      .onRef('va.chr', '=', 'v2.chr')
                      .onRef('va.pos', '=', 'v2.pos')
                      .onRef('va.ref', '=', 'v2.ref')
                      .onRef('va.alt', '=', 'v2.alt')
                  )
                  .where('va.global_comment', 'is not', null)
                  .where('va.global_comment', '!=', '')
                  .where('v2.case_id', '=', filter.case_id)
              )
          )
        )
      }
      return qb.where(
        'id',
        'in',
        this.kysely
          .selectFrom('case_variant_annotations')
          .select('variant_id')
          .where('case_id', '=', filter.case_id)
          .where('per_case_comment', 'is not', null)
          .where('per_case_comment', '!=', '')
      )
    })

    // ACMG classification filter (scope-dependent)
    query = query.$if((filter.acmg_classifications?.length ?? 0) > 0, (qb) => {
      if (filter.annotation_scope === 'all') {
        return qb.where(({ selectFrom, eb }) =>
          eb(
            'id',
            'in',
            selectFrom('case_variant_annotations')
              .select('variant_id')
              .where('case_id', '=', filter.case_id)
              .where('acmg_classification', 'in', filter.acmg_classifications!)
              .union(
                selectFrom('variants as v2')
                  .select('v2.id as variant_id')
                  .innerJoin('variant_annotations as va', (join) =>
                    join
                      .onRef('va.chr', '=', 'v2.chr')
                      .onRef('va.pos', '=', 'v2.pos')
                      .onRef('va.ref', '=', 'v2.ref')
                      .onRef('va.alt', '=', 'v2.alt')
                  )
                  .where('va.acmg_classification', 'in', filter.acmg_classifications!)
                  .where('v2.case_id', '=', filter.case_id)
              )
          )
        )
      }
      return qb.where(
        'id',
        'in',
        this.kysely
          .selectFrom('case_variant_annotations')
          .select('variant_id')
          .where('case_id', '=', filter.case_id)
          .where('acmg_classification', 'in', filter.acmg_classifications!)
      )
    })

    // Column filters (dynamic, type-aware)
    if (filter.column_filters !== undefined) {
      for (const [column, filterDef] of Object.entries(filter.column_filters)) {
        if (SORTABLE_COLUMNS[column] === undefined) continue
        const sqlColumn = SORTABLE_COLUMNS[column]
        const { operator, value } = filterDef

        if (operator === 'in' && Array.isArray(value)) {
          if (value.length === 0) continue
          // Parameterized IN clause using sql.join
          const params = sql.join(value.map((v) => sql`${String(v)}`))
          query = query.where(sql<boolean>`${sql.ref(sqlColumn)} IN (${params})`)
        } else if (operator === 'like' && typeof value === 'string') {
          if (value.trim() === '') continue // Skip empty — LIKE '%%' excludes NULLs unnecessarily
          query = query.where(sql`${sql.ref(sqlColumn)} COLLATE NOCASE`, 'like', `%${value}%`)
        } else if (
          (operator === '=' || operator === '!=') &&
          (typeof value === 'string' || typeof value === 'number')
        ) {
          // Exact match — NULLs excluded (user is looking for specific values)
          const num = Number(value)
          const compValue = typeof value === 'number' ? value : Number.isFinite(num) ? num : value
          query = query.where(sqlColumn as keyof Variant, operator as '=' | '!=', compValue)
        } else if (
          (operator === '<' || operator === '>' || operator === '<=' || operator === '>=') &&
          (typeof value === 'string' || typeof value === 'number')
        ) {
          // Range comparison — includeEmpty defaults to true (don't lose unannotated variants)
          const num = Number(value)
          const compValue = typeof value === 'number' ? value : Number.isFinite(num) ? num : value
          const col = sqlColumn as keyof Variant
          const op = operator as '<' | '>' | '<=' | '>='
          const includeNulls = filterDef.includeEmpty !== false
          if (includeNulls) {
            query = query.where(({ or, eb }) => or([eb(col, 'is', null), eb(col, op, compValue)]))
          } else {
            query = query.where(col, op, compValue)
          }
        }
      }
    }

    // ── Inheritance mode filters ─────────────────────────────
    // NOTE: filter.consider_phasing is accepted but not yet implemented.
    // Phasing-aware compound het detection (distinguishing 0|1 from 1|0)
    // will be added when long-read phased VCF import is supported.
    if (filter.inheritance_modes && filter.inheritance_modes.length > 0) {
      const modes = filter.inheritance_modes
      const cid = filter.case_id
      const gid = filter.analysis_group_id ?? null

      // Build parameterized SQL fragments (Kysely sql`` auto-binds interpolated values)
      const sqlConditions: ReturnType<typeof sql>[] = []

      // Solo modes
      if (modes.includes('homozygous')) {
        sqlConditions.push(sql`variants.gt_num IN ('1/1', '1|1')`)
      }
      if (modes.includes('heterozygous')) {
        sqlConditions.push(sql`variants.gt_num IN ('0/1', '0|1', '1|0')`)
      }
      if (modes.includes('x_hemizygous')) {
        sqlConditions.push(
          sql`(variants.chr IN ('X', 'chrX') AND variants.gt_num IN ('1/1', '1|1', '1'))`
        )
      }
      if (modes.includes('candidate_compound_het')) {
        sqlConditions.push(
          sql`(variants.gene_symbol IN (
            SELECT v2.gene_symbol FROM variants v2
            WHERE v2.case_id = ${cid}
              AND v2.gt_num IN ('0/1', '0|1', '1|0')
              AND v2.gene_symbol IS NOT NULL
            GROUP BY v2.gene_symbol HAVING COUNT(*) >= 2
          ) AND variants.gt_num IN ('0/1', '0|1', '1|0'))`
        )
      }

      // Trio modes — require analysis_group_id
      // NOTE: If only trio modes are selected without an analysis group,
      // conditions will be empty and no inheritance filter is applied.
      // The UI prevents this by disabling trio chips when no group is set.
      if (gid !== null) {
        if (modes.includes('de_novo')) {
          // Het in proband, absent or ref in both parents
          sqlConditions.push(sql`(
            variants.gt_num IN ('0/1', '0|1', '1|0')
            AND variants.id NOT IN (
              SELECT p.id FROM variants p
              INNER JOIN analysis_group_members agm_f
                ON agm_f.group_id = ${gid} AND agm_f.role = 'father'
              INNER JOIN variants f
                ON f.case_id = agm_f.case_id
                AND f.chr = p.chr AND f.pos = p.pos AND f.ref = p.ref AND f.alt = p.alt
                AND f.gt_num NOT IN ('0/0', '0|0', './.', '', '0')
              WHERE p.case_id = ${cid}
            )
            AND variants.id NOT IN (
              SELECT p.id FROM variants p
              INNER JOIN analysis_group_members agm_m
                ON agm_m.group_id = ${gid} AND agm_m.role = 'mother'
              INNER JOIN variants f
                ON f.case_id = agm_m.case_id
                AND f.chr = p.chr AND f.pos = p.pos AND f.ref = p.ref AND f.alt = p.alt
                AND f.gt_num NOT IN ('0/0', '0|0', './.', '', '0')
              WHERE p.case_id = ${cid}
            )
          )`)
        }

        if (modes.includes('autosomal_recessive')) {
          // Proband hom, parents NOT hom (must be het carriers or absent)
          sqlConditions.push(sql`(
            variants.gt_num IN ('1/1', '1|1')
            AND variants.id NOT IN (
              SELECT p.id FROM variants p
              INNER JOIN analysis_group_members agm_par
                ON agm_par.group_id = ${gid} AND agm_par.role IN ('father', 'mother')
              INNER JOIN variants par
                ON par.case_id = agm_par.case_id
                AND par.chr = p.chr AND par.pos = p.pos AND par.ref = p.ref AND par.alt = p.alt
                AND par.gt_num IN ('1/1', '1|1')
              WHERE p.case_id = ${cid}
            )
          )`)
        }

        if (modes.includes('compound_het')) {
          // Het variants in genes where:
          // 1. Gene has >= 2 distinct het variants in proband
          // 2. At least one variant is shared with father
          // 3. At least one DIFFERENT variant is shared with mother
          sqlConditions.push(sql`(
            variants.gt_num IN ('0/1', '0|1', '1|0')
            AND variants.gene_symbol IS NOT NULL
            AND variants.gene_symbol IN (
              SELECT v_inner.gene_symbol
              FROM variants v_inner
              WHERE v_inner.case_id = ${cid}
                AND v_inner.gt_num IN ('0/1', '0|1', '1|0')
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
                AND f.gt_num IN ('0/1', '0|1', '1|0')
              INNER JOIN variants pm
                ON pm.case_id = ${cid}
                AND pm.gene_symbol = pf.gene_symbol
                AND pm.gt_num IN ('0/1', '0|1', '1|0')
                AND (pm.chr != pf.chr OR pm.pos != pf.pos OR pm.ref != pf.ref OR pm.alt != pf.alt)
              INNER JOIN analysis_group_members agm_m
                ON agm_m.group_id = ${gid} AND agm_m.role = 'mother'
              INNER JOIN variants m ON m.case_id = agm_m.case_id
                AND m.chr = pm.chr AND m.pos = pm.pos AND m.ref = pm.ref AND m.alt = pm.alt
                AND m.gt_num IN ('0/1', '0|1', '1|0')
              WHERE pf.case_id = ${cid}
                AND pf.gt_num IN ('0/1', '0|1', '1|0')
                AND pf.gene_symbol IS NOT NULL
            )
          )`)
        }
      }

      // Combine all conditions with OR using Kysely's sql tagged templates
      if (sqlConditions.length === 1) {
        query = query.where(sql<boolean>`(${sqlConditions[0]})`)
      } else if (sqlConditions.length > 1) {
        // Build OR chain: (cond1 OR cond2 OR ...)
        let combined = sqlConditions[0]
        for (let i = 1; i < sqlConditions.length; i++) {
          combined = sql`${combined} OR ${sqlConditions[i]}`
        }
        query = query.where(sql<boolean>`(${combined})`)
      }
    }

    return query
  }

  /**
   * Apply ORDER BY to a Kysely query using sql template literals
   * for NULLS FIRST/LAST support (not natively available in Kysely 0.28.x).
   */
  applySort(query: VariantQueryBuilder, sortBy?: SortItem[]): VariantQueryBuilder {
    if (!sortBy || sortBy.length === 0) {
      return query.orderBy(sql`pos ASC NULLS LAST`).orderBy(sql`id ASC`)
    }

    let sorted = query
    let hasIdSort = false

    for (const sort of sortBy) {
      const sqlColumn = SORTABLE_COLUMNS[sort.key]
      if (sqlColumn === undefined) {
        mainLogger.warn(`Invalid sort column rejected: ${sort.key}`, 'VariantFilterBuilder')
        continue
      }
      const dir = sort.order === 'desc' ? 'DESC' : 'ASC'
      const nulls = 'NULLS LAST'
      sorted = sorted.orderBy(sql`${sql.ref(sqlColumn)} ${sql.raw(dir)} ${sql.raw(nulls)}`)
      if (sort.key === 'id') hasIdSort = true
    }

    if (!hasIdSort) {
      sorted = sorted.orderBy(sql`id ASC`)
    }

    return sorted
  }

  // ── Panel interval temp table ────────────────────────────────

  /**
   * Populate a temp table with panel intervals for large interval sets (>= 50).
   * Must be called before build() when filter.panel_intervals.length >= 50.
   */
  setupPanelIntervalsTable(intervals: Array<{ chr: string; start: number; end: number }>): void {
    this.db.exec(
      'CREATE TEMP TABLE IF NOT EXISTS _panel_intervals (chr TEXT, start_pos INTEGER, end_pos INTEGER)'
    )
    this.db.exec('DELETE FROM _panel_intervals')
    const insert = this.db.prepare(
      'INSERT INTO _panel_intervals (chr, start_pos, end_pos) VALUES (?, ?, ?)'
    )
    const insertMany = this.db.transaction(
      (items: Array<{ chr: string; start: number; end: number }>) => {
        for (const iv of items) {
          insert.run(iv.chr, iv.start, iv.end)
        }
      }
    )
    insertMany(intervals)
  }

  /**
   * Clean up the temp table after query execution.
   */
  cleanupPanelIntervalsTable(): void {
    this.db.exec('DROP TABLE IF EXISTS _panel_intervals')
  }

  /**
   * If filter uses large panel intervals, set up temp table before query.
   * Returns true if temp table was created (caller should clean up after).
   */
  preparePanelIntervals(filter: VariantFilter): boolean {
    if (filter.panel_intervals && filter.panel_intervals.length >= 50) {
      this.setupPanelIntervalsTable(filter.panel_intervals)
      return true
    }
    return false
  }
}
