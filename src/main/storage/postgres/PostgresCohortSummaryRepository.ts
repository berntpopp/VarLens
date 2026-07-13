/**
 * Sprint A PR-3 C2 — PostgresCohortSummaryRepository.
 *
 * Materialises the deduped cohort variant summary for the Postgres backend.
 * Mirrors the SQLite source of truth in src/shared/sql/cohort-summary-rebuild.ts
 * and src/main/database/CohortSummaryService.ts:
 *
 *   - rebuild(): TRUNCATE + INSERT from the deduped CTE (Pass-2 #4 — duplicate
 *     per-case rows count once). has_star/has_comment/acmg_best are derived
 *     from variant_annotations + case_variant_annotations at insertion time
 *     (Pass-9 #8 — otherwise every rebuild would reset the flags to false).
 *     cohort_frequency is recomputed in-place as the final rebuild step
 *     (C2a / Pass-3 HIGH #2) via recomputeCohortFrequency().
 *
 * Note on column names: the Postgres workflow schema names the comment columns
 * global_comment / per_case_comment and the ACMG column acmg_classification
 * (src/main/storage/postgres/migrations/sql/0005_create_workflow_tables.sql) —
 * not the placeholder names in the plan. The variants table has no variant_key
 * column, so it is composed inline as chr:pos:ref:alt to match SQLite.
 *
 * The remaining methods are stubbed for the subsequent Sprint A tasks.
 */
import type { PoolClient } from 'pg'
import { getCohortSummaryState, markCohortSummaryStale } from './cohort-summary-state-sql'

interface ScopedClient {
  schema: string
  client: PoolClient
}

/**
 * ACMG rank ladder mirroring the SQLite CASE expression in
 * src/shared/sql/cohort-summary-rebuild.ts. Higher rank wins; the textual
 * label is reconstructed from the winning rank.
 */
/**
 * Filterable base columns mirrored verbatim from the SQLite source of truth
 * BASE_SORTABLE_COLUMNS (src/main/database/VariantFilterBuilder.ts) — the exact
 * column set whose per-case metadata getAllColumnMetas computes in SQLite. The
 * Postgres `variants` table uses identical physical column names, so key and
 * SQL column coincide. Kept local because VariantFilterBuilder is Kysely/SQLite
 * side and must not be imported into the Postgres path.
 */
const META_COLUMNS = [
  'chr',
  'pos',
  'gene_symbol',
  'omim_mim_number',
  'func',
  'consequence',
  'transcript',
  'cdna',
  'aa_change',
  'gt_num',
  'gnomad_af',
  'cadd',
  'qual',
  'hpo_sim_score',
  'clinvar',
  'moi',
  'variant_type',
  'end_pos',
  'sv_type',
  'sv_length',
  'caller'
] as const

/**
 * Numeric columns get MIN/MAX in min_value/max_value, mirroring SQLite's
 * NUMERIC_COLUMNS set in src/main/database/VariantRepository.ts.
 */
const META_NUMERIC_COLUMNS = new Set<string>(['pos', 'gnomad_af', 'cadd', 'qual', 'hpo_sim_score'])

/**
 * Low-cardinality threshold mirroring SQLite's DISTINCT_THRESHOLD — columns at
 * or below this distinct count get their distinct_values array materialised.
 */
const META_DISTINCT_THRESHOLD = 50

const ACMG_RANK_SQL = (col: string) => `CASE ${col}
  WHEN 'Pathogenic' THEN 5
  WHEN 'Likely pathogenic' THEN 4
  WHEN 'Uncertain significance' THEN 3
  WHEN 'Likely benign' THEN 2
  WHEN 'Benign' THEN 1
  ELSE 0 END`

/** Deduped per-coordinate aggregate for one case, shared by add/remove. */
export const SCOPED_DEDUPED_AGG_SQL = (tbl: (t: string) => string, includeProvisional = false) => `
  WITH deduped AS (
    SELECT v.chr, v.pos, v.ref, v.alt, v.variant_type, c.genome_build,
           MAX(v.end_pos) AS end_pos,
           MAX(v.gene_symbol) AS gene_symbol,
           MAX(v.cdna) AS cdna,
           MAX(v.aa_change) AS aa_change,
           MAX(v.consequence) AS consequence,
           MAX(v.func) AS func,
           MAX(v.clinvar) AS clinvar,
           MAX(v.gnomad_af) AS gnomad_af,
           MAX(v.cadd) AS cadd,
           MAX(v.transcript) AS transcript,
           MAX(v.omim_mim_number) AS omim_mim_number,
           MAX(v.gt_num) AS gt_num
    FROM ${tbl(includeProvisional ? 'variants_all' : 'variants')} v
    JOIN ${tbl(includeProvisional ? 'cases_all' : 'cases')} c ON c.id = v.case_id
    WHERE v.case_id = $1
    GROUP BY v.chr, v.pos, v.ref, v.alt, v.variant_type, c.genome_build
  ),
  per_case AS (
    SELECT chr, pos, ref, alt, variant_type, genome_build,
           MAX(end_pos) AS end_pos,
           MAX(gene_symbol) AS gene_symbol,
           MAX(cdna) AS cdna,
           MAX(aa_change) AS aa_change,
           MAX(consequence) AS consequence,
           MAX(func) AS func,
           MAX(clinvar) AS clinvar,
           MAX(gnomad_af) AS gnomad_af,
           MAX(cadd) AS cadd,
           MAX(transcript) AS transcript,
           MAX(omim_mim_number) AS omim_mim_number,
           COUNT(*) AS carrier_delta,
           SUM(CASE WHEN gt_num IN ('0/1','1/0','0|1','1|0') THEN 1 ELSE 0 END) AS het_delta,
           SUM(CASE WHEN gt_num IN ('1/1','1|1') THEN 1 ELSE 0 END) AS hom_delta
    FROM deduped
    GROUP BY chr, pos, ref, alt, variant_type, genome_build
  )`

export class PostgresCohortSummaryRepository {
  async rebuild({ schema, client }: ScopedClient): Promise<void> {
    const tbl = (t: string): string => `"${schema}"."${t}"`

    await client.query(`TRUNCATE ${tbl('cohort_variant_summary')}`)

    // Deduped CTE + flag-bearing projection. Mirrors SQLite
    // src/main/database/CohortSummaryService.ts and the deduped pattern in
    // src/shared/sql/cohort-summary-rebuild.ts.
    await client.query(`
      INSERT INTO ${tbl('cohort_variant_summary')}
        (chr, pos, end_pos, ref, alt, variant_type, genome_build,
         gene_symbol, cdna, aa_change, consequence, func, clinvar,
         gnomad_af, cadd, transcript, omim_mim_number,
         carrier_count, het_count, hom_count, variant_key,
         has_star, has_comment, acmg_best, cohort_frequency)
      WITH deduped AS (
        SELECT v.chr, v.pos, v.ref, v.alt, v.case_id, v.variant_type, c.genome_build,
               MAX(v.end_pos) AS end_pos,
               MAX(v.gene_symbol) AS gene_symbol,
               MAX(v.cdna) AS cdna,
               MAX(v.aa_change) AS aa_change,
               MAX(v.consequence) AS consequence,
               MAX(v.func) AS func,
               MAX(v.clinvar) AS clinvar,
               MAX(v.gnomad_af) AS gnomad_af,
               MAX(v.cadd) AS cadd,
               MAX(v.transcript) AS transcript,
               MAX(v.omim_mim_number) AS omim_mim_number,
               MAX(v.gt_num) AS gt_num
        FROM ${tbl('variants')} v
        JOIN ${tbl('cases')} c ON c.id = v.case_id
        GROUP BY v.chr, v.pos, v.ref, v.alt, v.case_id, v.variant_type, c.genome_build
      ),
      agg AS (
        SELECT d.chr, d.pos, MAX(d.end_pos) AS end_pos, d.ref, d.alt,
               d.variant_type, d.genome_build,
               MAX(d.gene_symbol) AS gene_symbol,
               MAX(d.cdna) AS cdna,
               MAX(d.aa_change) AS aa_change,
               MAX(d.consequence) AS consequence,
               MAX(d.func) AS func,
               MAX(d.clinvar) AS clinvar,
               MAX(d.gnomad_af) AS gnomad_af,
               MAX(d.cadd) AS cadd,
               MAX(d.transcript) AS transcript,
               MAX(d.omim_mim_number) AS omim_mim_number,
               COUNT(*) AS carrier_count,
               SUM(CASE WHEN d.gt_num IN ('0/1','1/0','0|1','1|0') THEN 1 ELSE 0 END) AS het_count,
               SUM(CASE WHEN d.gt_num IN ('1/1','1|1') THEN 1 ELSE 0 END) AS hom_count
        FROM deduped d
        GROUP BY d.chr, d.pos, d.ref, d.alt, d.variant_type, d.genome_build
      )
      SELECT
        a.chr, a.pos, a.end_pos, a.ref, a.alt, a.variant_type, a.genome_build,
        a.gene_symbol, a.cdna, a.aa_change, a.consequence, a.func, a.clinvar,
        a.gnomad_af, a.cadd, a.transcript, a.omim_mim_number,
        a.carrier_count, a.het_count, a.hom_count,
        a.chr || ':' || a.pos || ':' || a.ref || ':' || a.alt AS variant_key,
        -- Pass-9 #8: derive flag columns from current annotation tables.
        (EXISTS (
          SELECT 1 FROM ${tbl('variant_annotations')} va
          WHERE va.chr = a.chr AND va.pos = a.pos
            AND va.ref = a.ref AND va.alt = a.alt
            AND va.starred = 1
        ) OR EXISTS (
          SELECT 1 FROM ${tbl('case_variant_annotations')} cva
          JOIN ${tbl('variants')} v ON cva.variant_id = v.id
          WHERE v.chr = a.chr AND v.pos = a.pos
            AND v.ref = a.ref AND v.alt = a.alt
            AND v.variant_type = a.variant_type
            AND cva.starred = 1
        )) AS has_star,
        (EXISTS (
          SELECT 1 FROM ${tbl('variant_annotations')} va
          WHERE va.chr = a.chr AND va.pos = a.pos
            AND va.ref = a.ref AND va.alt = a.alt
            AND va.global_comment IS NOT NULL AND va.global_comment <> ''
        ) OR EXISTS (
          SELECT 1 FROM ${tbl('case_variant_annotations')} cva
          JOIN ${tbl('variants')} v ON cva.variant_id = v.id
          WHERE v.chr = a.chr AND v.pos = a.pos
            AND v.ref = a.ref AND v.alt = a.alt
            AND v.variant_type = a.variant_type
            AND cva.per_case_comment IS NOT NULL AND cva.per_case_comment <> ''
        )) AS has_comment,
        -- acmg_best: highest-ranked classification across global + per-case
        -- annotations, reconstructed from the winning rank (mirrors the SQLite
        -- CASE ladder in src/shared/sql/cohort-summary-rebuild.ts).
        (CASE (
          SELECT MAX(rank) FROM (
            SELECT ${ACMG_RANK_SQL('va.acmg_classification')} AS rank
            FROM ${tbl('variant_annotations')} va
            WHERE va.chr = a.chr AND va.pos = a.pos
              AND va.ref = a.ref AND va.alt = a.alt
              AND va.acmg_classification IS NOT NULL
            UNION ALL
            SELECT ${ACMG_RANK_SQL('cva.acmg_classification')} AS rank
            FROM ${tbl('case_variant_annotations')} cva
            JOIN ${tbl('variants')} v ON cva.variant_id = v.id
            WHERE v.chr = a.chr AND v.pos = a.pos
              AND v.ref = a.ref AND v.alt = a.alt
              AND v.variant_type = a.variant_type
              AND cva.acmg_classification IS NOT NULL
          ) ranked
        )
          WHEN 5 THEN 'Pathogenic'
          WHEN 4 THEN 'Likely pathogenic'
          WHEN 3 THEN 'Uncertain significance'
          WHEN 2 THEN 'Likely benign'
          WHEN 1 THEN 'Benign'
          ELSE NULL
        END) AS acmg_best,
        NULL AS cohort_frequency  -- overwritten by the recompute below (C2a)
      FROM agg a;
    `)

    // C2a: recompute cohort_frequency for all builds as the final rebuild step,
    // inside the same transaction. Mirrors SQLite's RECOMPUTE_ALL_FREQUENCIES_SQL
    // (CohortSummaryService.rebuild). The NULL written above is overwritten here.
    await this.recomputeCohortFrequency({ schema, client })

    // C1 lifecycle (Pass-7 MED #4): a completed rebuild clears the staleness
    // flags and records the rebuild time. last_rebuilt_at maps back to epoch ms
    // via getState's EXTRACT(EPOCH) (Pass-9 #6).
    await client.query(
      `UPDATE ${tbl('cohort_summary_state')}
       SET is_stale = false, stale_reason = NULL, stale_at = NULL, last_rebuilt_at = now()
       WHERE id = 1`
    )
  }

  /**
   * C2a (Pass-3 HIGH #2): recompute cohort_frequency = carrier_count / total
   * cases-for-build. Mirrors SQLite's RECOMPUTE_ALL_FREQUENCIES_SQL, run in the
   * same transaction after rebuild / incrementalAdd / incrementalRemove. When
   * `affectedBuilds` is provided the recompute is scoped to those genome_builds
   * (the incremental paths pass the case's build); when omitted the full table
   * is recomputed (the rebuild path).
   */
  async recomputeCohortFrequency({
    schema,
    client,
    affectedBuilds,
    includeProvisional = false
  }: ScopedClient & { affectedBuilds?: string[]; includeProvisional?: boolean }): Promise<void> {
    const tbl = (t: string): string => `"${schema}"."${t}"`
    const casesTable = tbl(includeProvisional ? 'cases_all' : 'cases')
    if (affectedBuilds && affectedBuilds.length > 0) {
      await client.query(
        `UPDATE ${tbl('cohort_variant_summary')} cvs
         SET cohort_frequency = cvs.carrier_count::float / NULLIF(c.total, 0)
         FROM (SELECT genome_build, COUNT(*) AS total FROM ${casesTable} GROUP BY genome_build) c
         WHERE cvs.genome_build = c.genome_build
           AND cvs.genome_build = ANY($1::text[])`,
        [affectedBuilds]
      )
    } else {
      await client.query(
        `UPDATE ${tbl('cohort_variant_summary')} cvs
         SET cohort_frequency = cvs.carrier_count::float / NULLIF(c.total, 0)
         FROM (SELECT genome_build, COUNT(*) AS total FROM ${casesTable} GROUP BY genome_build) c
         WHERE cvs.genome_build = c.genome_build`
      )
    }
  }

  /**
   * Add one case's variants to the summary. INSERT … SELECT from the deduped
   * per-case CTE, ON CONFLICT bumping all three counters simultaneously
   * (Pass-6 MED #3). Flags use OR semantics so an add never clears an existing
   * annotation flag; on the INSERT (brand-new row) path the flags come from the
   * same EXISTS expressions as rebuild().
   */
  async incrementalAdd({
    schema,
    client,
    caseId,
    genomeBuild,
    includeProvisional = false
  }: ScopedClient & {
    caseId: number
    genomeBuild?: string
    includeProvisional?: boolean
  }): Promise<void> {
    const tbl = (t: string): string => `"${schema}"."${t}"`

    await client.query(
      `
      INSERT INTO ${tbl('cohort_variant_summary')}
        (chr, pos, end_pos, ref, alt, variant_type, genome_build,
         gene_symbol, cdna, aa_change, consequence, func, clinvar,
         gnomad_af, cadd, transcript, omim_mim_number,
         carrier_count, het_count, hom_count, variant_key,
         has_star, has_comment, acmg_best, cohort_frequency)
      ${SCOPED_DEDUPED_AGG_SQL(tbl, includeProvisional)}
      SELECT
        pc.chr, pc.pos, pc.end_pos, pc.ref, pc.alt, pc.variant_type, pc.genome_build,
        pc.gene_symbol, pc.cdna, pc.aa_change, pc.consequence, pc.func, pc.clinvar,
        pc.gnomad_af, pc.cadd, pc.transcript, pc.omim_mim_number,
        pc.carrier_delta, pc.het_delta, pc.hom_delta,
        pc.chr || ':' || pc.pos || ':' || pc.ref || ':' || pc.alt AS variant_key,
        -- Pass-9 #8: brand-new rows derive flags from current annotation tables.
        (EXISTS (
          SELECT 1 FROM ${tbl('variant_annotations')} va
          WHERE va.chr = pc.chr AND va.pos = pc.pos
            AND va.ref = pc.ref AND va.alt = pc.alt
            AND va.starred = 1
        ) OR EXISTS (
          SELECT 1 FROM ${tbl('case_variant_annotations')} cva
          JOIN ${tbl('variants')} v ON cva.variant_id = v.id
          WHERE v.chr = pc.chr AND v.pos = pc.pos
            AND v.ref = pc.ref AND v.alt = pc.alt
            AND v.variant_type = pc.variant_type
            AND cva.starred = 1
        )) AS has_star,
        (EXISTS (
          SELECT 1 FROM ${tbl('variant_annotations')} va
          WHERE va.chr = pc.chr AND va.pos = pc.pos
            AND va.ref = pc.ref AND va.alt = pc.alt
            AND va.global_comment IS NOT NULL AND va.global_comment <> ''
        ) OR EXISTS (
          SELECT 1 FROM ${tbl('case_variant_annotations')} cva
          JOIN ${tbl('variants')} v ON cva.variant_id = v.id
          WHERE v.chr = pc.chr AND v.pos = pc.pos
            AND v.ref = pc.ref AND v.alt = pc.alt
            AND v.variant_type = pc.variant_type
            AND cva.per_case_comment IS NOT NULL AND cva.per_case_comment <> ''
        )) AS has_comment,
        (CASE (
          SELECT MAX(rank) FROM (
            SELECT ${ACMG_RANK_SQL('va.acmg_classification')} AS rank
            FROM ${tbl('variant_annotations')} va
            WHERE va.chr = pc.chr AND va.pos = pc.pos
              AND va.ref = pc.ref AND va.alt = pc.alt
              AND va.acmg_classification IS NOT NULL
            UNION ALL
            SELECT ${ACMG_RANK_SQL('cva.acmg_classification')} AS rank
            FROM ${tbl('case_variant_annotations')} cva
            JOIN ${tbl('variants')} v ON cva.variant_id = v.id
            WHERE v.chr = pc.chr AND v.pos = pc.pos
              AND v.ref = pc.ref AND v.alt = pc.alt
              AND v.variant_type = pc.variant_type
              AND cva.acmg_classification IS NOT NULL
          ) ranked
        )
          WHEN 5 THEN 'Pathogenic'
          WHEN 4 THEN 'Likely pathogenic'
          WHEN 3 THEN 'Uncertain significance'
          WHEN 2 THEN 'Likely benign'
          WHEN 1 THEN 'Benign'
          ELSE NULL
        END) AS acmg_best,
        NULL AS cohort_frequency  -- overwritten by the recompute below (C2a)
      FROM per_case pc
      ON CONFLICT (chr, pos, ref, alt, variant_type, genome_build) DO UPDATE SET
        carrier_count = cohort_variant_summary.carrier_count + EXCLUDED.carrier_count,
        het_count = cohort_variant_summary.het_count + EXCLUDED.het_count,
        hom_count = cohort_variant_summary.hom_count + EXCLUDED.hom_count,
        -- Adds never clear annotation flags (OR semantics).
        has_star = cohort_variant_summary.has_star OR EXCLUDED.has_star,
        has_comment = cohort_variant_summary.has_comment OR EXCLUDED.has_comment;
    `,
      [caseId]
    )

    // C2a: recompute cohort_frequency in the same transaction, scoped to the
    // case's genome_build when supplied by the caller (mirrors SQLite's
    // RECOMPUTE_ALL_FREQUENCIES_SQL after INCREMENTAL_ADD_SQL).
    await this.recomputeCohortFrequency({
      schema,
      client,
      affectedBuilds: genomeBuild !== undefined ? [genomeBuild] : undefined,
      includeProvisional
    })

    // C1 lifecycle: incremental maintenance records its time but never touches
    // is_stale — the summary stays valid (Pass-7 MED #4).
    await client.query(
      `UPDATE ${tbl('cohort_summary_state')} SET last_incremental_at = now() WHERE id = 1`
    )
  }

  /**
   * Remove one case's variants from the summary. UPDATE-from-CTE subtracting all
   * three counters simultaneously (Pass-6 MED #3), then a sibling DELETE of any
   * row that dropped to zero carriers (Pass-2 verdict #1 — separate statement,
   * not a sibling CTE). Mirrors SQLite INCREMENTAL_REMOVE_SQL +
   * CLEANUP_ZERO_CARRIERS_SQL.
   */
  async incrementalRemove({
    schema,
    client,
    caseId,
    genomeBuild
  }: ScopedClient & { caseId: number; genomeBuild?: string }): Promise<void> {
    const tbl = (t: string): string => `"${schema}"."${t}"`

    await client.query(
      `
      ${SCOPED_DEDUPED_AGG_SQL(tbl)}
      UPDATE ${tbl('cohort_variant_summary')} cvs
      SET carrier_count = cvs.carrier_count - per_case.carrier_delta,
          het_count = cvs.het_count - per_case.het_delta,
          hom_count = cvs.hom_count - per_case.hom_delta
      FROM per_case
      WHERE cvs.chr = per_case.chr AND cvs.pos = per_case.pos
        AND cvs.ref = per_case.ref AND cvs.alt = per_case.alt
        AND cvs.variant_type = per_case.variant_type
        AND cvs.genome_build = per_case.genome_build;
    `,
      [caseId]
    )

    await client.query(`DELETE FROM ${tbl('cohort_variant_summary')} WHERE carrier_count <= 0`)

    // C2a: recompute cohort_frequency in the same transaction, scoped to the
    // case's genome_build when supplied (mirrors SQLite's
    // RECOMPUTE_ALL_FREQUENCIES_SQL after INCREMENTAL_REMOVE_SQL +
    // CLEANUP_ZERO_CARRIERS_SQL).
    await this.recomputeCohortFrequency({
      schema,
      client,
      affectedBuilds: genomeBuild !== undefined ? [genomeBuild] : undefined
    })

    // C1 lifecycle: incremental maintenance records its time but never touches
    // is_stale — the summary stays valid (Pass-7 MED #4).
    await client.query(
      `UPDATE ${tbl('cohort_summary_state')} SET last_incremental_at = now() WHERE id = 1`
    )
  }
  /**
   * Recompute the per-case filter metadata cache. Mirrors SQLite's
   * getAllColumnMetas (src/main/database/VariantRepository.ts): one row per
   * filterable base column with distinct_count for every column, MIN/MAX for
   * numerics, and the sorted distinct_values array for low-cardinality columns
   * (≤ META_DISTINCT_THRESHOLD). DELETE-then-INSERT per C5a HIGH #2 so a refresh
   * fully repopulates the case's rows.
   */
  async refreshColumnMetas({
    schema,
    client,
    caseId,
    includeProvisional = false
  }: ScopedClient & { caseId: number; includeProvisional?: boolean }): Promise<void> {
    const tbl = (t: string): string => `"${schema}"."${t}"`
    const variantsTable = tbl(includeProvisional ? 'variants_all' : 'variants')

    await client.query(`DELETE FROM ${tbl('cohort_column_meta')} WHERE case_id = $1`, [caseId])

    // Single scan: COUNT(DISTINCT col) for every column, plus MIN/MAX for
    // numerics. Aliases are positional so the column order is deterministic.
    const aggSelect: string[] = []
    for (const col of META_COLUMNS) {
      aggSelect.push(`COUNT(DISTINCT "${col}") AS "cnt_${col}"`)
      if (META_NUMERIC_COLUMNS.has(col)) {
        aggSelect.push(`MIN("${col}") AS "min_${col}"`)
        aggSelect.push(`MAX("${col}") AS "max_${col}"`)
      }
    }
    const aggRes = await client.query(
      `SELECT ${aggSelect.join(', ')} FROM ${variantsTable} WHERE case_id = $1`,
      [caseId]
    )
    const aggRow = (aggRes.rows[0] ?? {}) as Record<string, string | number | null>

    // Second scan: distinct values for low-cardinality columns only.
    const lowCardinality = META_COLUMNS.filter((col) => {
      const cnt = Number(aggRow[`cnt_${col}`] ?? 0)
      return cnt > 0 && cnt <= META_DISTINCT_THRESHOLD
    })

    const distinctValuesByColumn = new Map<string, string[]>()
    if (lowCardinality.length > 0) {
      const unionParts = lowCardinality.map(
        (col) =>
          `SELECT '${col}' AS col_key, CAST("${col}" AS TEXT) AS val
             FROM ${variantsTable}
             WHERE case_id = $1 AND "${col}" IS NOT NULL
             GROUP BY "${col}"`
      )
      const distinctRes = await client.query<{ col_key: string; val: string }>(
        unionParts.join(' UNION ALL '),
        [caseId]
      )
      for (const row of distinctRes.rows) {
        let arr = distinctValuesByColumn.get(row.col_key)
        if (arr === undefined) {
          arr = []
          distinctValuesByColumn.set(row.col_key, arr)
        }
        arr.push(row.val)
      }
    }

    // Single multi-row INSERT for all columns (one round trip). min_value /
    // max_value / distinct_values are JSONB. Numeric min/max are coerced through
    // Number(...) before JSON.stringify so BIGINT-backed columns like `pos`
    // (node-pg returns these as strings) store as JSON numbers, matching
    // SQLite's raw-number shape and the float8 columns (gnomad_af, cadd, qual,
    // hpo_sim_score) which node-pg already returns as numbers.
    const valuesClauses: string[] = []
    const params: unknown[] = []
    for (const col of META_COLUMNS) {
      const distinctCount = Number(aggRow[`cnt_${col}`] ?? 0)
      const isNumeric = META_NUMERIC_COLUMNS.has(col)
      const minRaw = isNumeric ? (aggRow[`min_${col}`] ?? null) : null
      const maxRaw = isNumeric ? (aggRow[`max_${col}`] ?? null) : null
      const values = distinctValuesByColumn.get(col)
      const distinctValues =
        values !== undefined ? [...values].sort((a, b) => a.localeCompare(b)) : null

      const base = params.length
      valuesClauses.push(
        `($${base + 1}, $${base + 2}, $${base + 3}::jsonb, $${base + 4}::jsonb, $${base + 5}, $${base + 6}::jsonb)`
      )
      params.push(
        caseId,
        col,
        minRaw === null ? null : JSON.stringify(Number(minRaw)),
        maxRaw === null ? null : JSON.stringify(Number(maxRaw)),
        distinctCount,
        distinctValues === null ? null : JSON.stringify(distinctValues)
      )
    }

    await client.query(
      `INSERT INTO ${tbl('cohort_column_meta')}
         (case_id, column_name, min_value, max_value, distinct_count, distinct_values)
       VALUES ${valuesClauses.join(', ')}`,
      params
    )
  }

  /**
   * Drop a single case's column-meta rows. The ON DELETE CASCADE from C1 makes
   * this redundant when the case row is deleted in the same transaction, but C3
   * calls it explicitly to support the "remove without deleting case" path.
   */
  async removeColumnMetas({
    schema,
    client,
    caseId
  }: ScopedClient & { caseId: number }): Promise<void> {
    const tbl = (t: string): string => `"${schema}"."${t}"`
    await client.query(`DELETE FROM ${tbl('cohort_column_meta')} WHERE case_id = $1`, [caseId])
  }
  /**
   * Return the singleton lifecycle state in the existing IPC shape
   * { is_stale, last_rebuilt_at:number }. Delegates to getCohortSummaryState
   * in ./cohort-summary-state-sql (Pass-7 MED #4 + Pass-8 #7 + Pass-9 #6).
   */
  async getState(scope: ScopedClient): Promise<{ is_stale: boolean; last_rebuilt_at: number }> {
    return getCohortSummaryState(scope)
  }

  /**
   * Flag the summary stale with an explicit reason. Delegates to
   * markCohortSummaryStale in ./cohort-summary-state-sql (Pass-7 MED #4);
   * leaves last_rebuilt_at untouched so rebuild history is preserved.
   */
  async markStale(scope: ScopedClient & { reason: string }): Promise<void> {
    return markCohortSummaryStale(scope)
  }
}
