/**
 * Shared SQL constants for cohort summary table rebuild.
 *
 * Used by CohortSummaryService (main thread), import-worker, delete-worker,
 * and rebuild-summary-worker. Single source of truth to avoid SQL drift.
 */
import { acmgLabelCaseSql, acmgRankCaseSql } from '../config/severity.config'
import {
  REPRESENTATIVE_COLUMNS,
  representativeColumnList,
  summaryColumnsOverWindow,
  transcriptOrderBy
} from './cohort-representative'

const HET = "('0/1','1/0','0|1','1|0')"
const HOM = "('1/1','1|1')"
const SUMMARY_KEY = ['chr', 'pos', 'ref', 'alt', 'variant_type', 'genome_build'] as const

/**
 * INSERT-SELECT that (re)computes cohort_variant_summary rows from `variants`.
 * `variantFilter` is appended after the `JOIN cases` of the per-case step
 * (e.g. a `WHERE (v.chr, v.pos, v.ref, v.alt) IN (...)` restriction); the
 * empty string recomputes every coordinate. One template for the full
 * rebuild and the per-coordinate incremental path keeps the two in lockstep.
 *
 * Per summary key the transcript-level columns are those of ONE carrier row
 * and the variant-level facts are aggregated over all carrier rows (#469,
 * cohort-representative.ts). A case counts once per key whatever number of
 * rows it has there: `case_rows` reduces it to one row first.
 *
 * `cohort_frequency` is deliberately not written (it stays NULL): readers
 * derive it from carrier_count and the build's case count — see
 * src/main/database/cohort-frequency-sql.ts.
 */
export function variantSummaryInsertSql(variantFilter = ''): string {
  return `
  INSERT INTO cohort_variant_summary (
    chr, pos, ref, alt, ${REPRESENTATIVE_COLUMNS.join(', ')},
    carrier_count, het_count, hom_count,
    has_star, has_comment, acmg_best,
    variant_key, variant_type, genome_build
  )
  SELECT
    d.chr, d.pos, d.ref, d.alt, ${representativeColumnList('d')},
    d.carrier_count, d.het_count, d.hom_count,
    CASE WHEN va.starred = 1 THEN 1 ELSE 0 END,
    CASE WHEN va.global_comment IS NOT NULL AND va.global_comment != '' THEN 1 ELSE 0 END,
    va.acmg_classification,
    d.chr || ':' || d.pos || ':' || d.ref || ':' || d.alt,
    d.variant_type, d.genome_build
  FROM (
    WITH case_rows AS (
      SELECT v.chr, v.pos, v.ref, v.alt, v.variant_type, c.genome_build, v.case_id,
        ${summaryColumnsOverWindow('v', 'case_key', 'sqlite')},
        MAX(v.gt_num) OVER case_key AS gt_num,
        ROW_NUMBER() OVER (case_key ORDER BY ${transcriptOrderBy('v', 'sqlite')}) AS case_rn
      FROM variants v
      JOIN cases c ON c.id = v.case_id AND c.import_status = 'ready'${variantFilter}
      WINDOW case_key AS (
        PARTITION BY v.chr, v.pos, v.ref, v.alt, v.variant_type, c.genome_build, v.case_id
      )
    ),
    key_rows AS (
      SELECT ${SUMMARY_KEY.map((column) => `r.${column}`).join(', ')},
        ${summaryColumnsOverWindow('r', 'summary_key', 'sqlite')},
        COUNT(*) OVER summary_key AS carrier_count,
        SUM(CASE WHEN r.gt_num IN ${HET} THEN 1 ELSE 0 END) OVER summary_key AS het_count,
        SUM(CASE WHEN r.gt_num IN ${HOM} THEN 1 ELSE 0 END) OVER summary_key AS hom_count,
        ROW_NUMBER() OVER (summary_key ORDER BY ${transcriptOrderBy('r', 'sqlite')}) AS key_rn
      FROM case_rows r
      WHERE r.case_rn = 1
      WINDOW summary_key AS (PARTITION BY ${SUMMARY_KEY.map((column) => `r.${column}`).join(', ')})
    )
    SELECT * FROM key_rows WHERE key_rn = 1
  ) d
  LEFT JOIN variant_annotations va
    ON va.chr = d.chr AND va.pos = d.pos AND va.ref = d.ref AND va.alt = d.alt;
`
}

export const REBUILD_VARIANT_SUMMARY_SQL = `
  DELETE FROM cohort_variant_summary;
${variantSummaryInsertSql()}`

/**
 * Folds per-case stars / comments / ACMG calls (case_variant_annotations) into
 * the summary flags, on top of the variant_annotations base the INSERT-SELECT
 * above writes. `variantFilter` is appended after the `JOIN variants v` (e.g.
 * a `WHERE v.chr = @chr ...` restriction for one recomputed coordinate); the
 * empty string covers every annotated coordinate.
 */
export function perCaseAnnotationFlagsSql(variantFilter = ''): string {
  return `
  UPDATE cohort_variant_summary SET
    has_star = CASE WHEN cohort_variant_summary.has_star = 1 THEN 1 WHEN pca.has_star = 1 THEN 1 ELSE 0 END,
    has_comment = CASE WHEN cohort_variant_summary.has_comment = 1 THEN 1 WHEN pca.has_comment = 1 THEN 1 ELSE 0 END,
    acmg_best = CASE
      WHEN pca.acmg_rank > ${acmgRankCaseSql('cohort_variant_summary.acmg_best')}
      THEN pca.acmg_best
      ELSE cohort_variant_summary.acmg_best
    END
  FROM (
    SELECT v.chr, v.pos, v.ref, v.alt,
      MAX(cva.starred) AS has_star,
      MAX(CASE WHEN cva.per_case_comment IS NOT NULL AND cva.per_case_comment != ''
        THEN 1 ELSE 0 END) AS has_comment,
      ${acmgLabelCaseSql(`MAX(${acmgRankCaseSql('cva.acmg_classification')})`)} AS acmg_best,
      MAX(${acmgRankCaseSql('cva.acmg_classification')}) AS acmg_rank
    FROM case_variant_annotations cva
    JOIN variants v ON cva.variant_id = v.id${variantFilter}
    GROUP BY v.chr, v.pos, v.ref, v.alt
  ) pca
  WHERE cohort_variant_summary.chr = pca.chr
    AND cohort_variant_summary.pos = pca.pos
    AND cohort_variant_summary.ref = pca.ref
    AND cohort_variant_summary.alt = pca.alt;
`
}

export const UPDATE_PER_CASE_ANNOTATION_FLAGS_SQL = perCaseAnnotationFlagsSql()

/**
 * INSERT-SELECT for gene_burden_summary. `geneFilter` is appended to the
 * WHERE clause (e.g. `AND v.gene_symbol IN (...)`); empty recomputes every gene.
 */
export function geneBurdenInsertSql(geneFilter = ''): string {
  return `
  INSERT INTO gene_burden_summary (
    gene_symbol, variant_count, unique_variant_count,
    affected_case_count, updated_at, genome_build
  )
  SELECT
    v.gene_symbol,
    COUNT(*) AS variant_count,
    COUNT(DISTINCT v.chr || ':' || v.pos || ':' || v.ref || ':' || v.alt) AS unique_variant_count,
    COUNT(DISTINCT v.case_id) AS affected_case_count,
    CAST(strftime('%s', 'now') AS INTEGER),
    c.genome_build
  FROM variants v
  JOIN cases c ON c.id = v.case_id AND c.import_status = 'ready'
  WHERE v.gene_symbol IS NOT NULL AND v.gene_symbol != ''${geneFilter}
  GROUP BY v.gene_symbol, c.genome_build;
`
}

export const REBUILD_GENE_BURDEN_SQL = `
  DELETE FROM gene_burden_summary;
${geneBurdenInsertSql()}`

/** Meta key of the maintained unique-variant counter (cohort-unique-variant-count.ts). */
export const UNIQUE_VARIANT_COUNT_KEY = 'unique_variant_count'

/** Distinct (chr, pos, ref, alt) in the summary: its key also has type and build. */
export const COUNT_UNIQUE_VARIANTS_SQL = `
  SELECT COUNT(*) AS c FROM (SELECT DISTINCT chr, pos, ref, alt FROM cohort_variant_summary)`

export const RECOUNT_UNIQUE_VARIANTS_SQL = `
  INSERT OR REPLACE INTO cohort_summary_meta (key, value)
  VALUES ('${UNIQUE_VARIANT_COUNT_KEY}', CAST((${COUNT_UNIQUE_VARIANTS_SQL}) AS TEXT));
`

/**
 * Meta key: an import session is maintaining the summary incrementally
 * (src/main/database/cohort-summary-case-add.ts). Left behind by a session
 * that died, it means "the summary may not match the variants".
 */
export const IMPORT_SESSION_OPEN_KEY = 'import_session_open'

/**
 * Last step of every full rebuild, in its transaction.
 *
 * The rebuild made the summary match every variant committed so far, so it
 * also settles an unfinished import session: the marker goes, or every app
 * start would rebuild again until the next import. A session that is still
 * running puts the marker back with its next write (see `keepSessionOpen` in
 * cohort-summary-case-add.ts), in the transaction that makes the summary
 * incomplete again.
 */
export const UPDATE_META_SQL = `
  INSERT OR REPLACE INTO cohort_summary_meta (key, value)
  VALUES ('last_rebuilt_at', CAST(strftime('%s', 'now') AS TEXT));
${RECOUNT_UNIQUE_VARIANTS_SQL}  DELETE FROM cohort_summary_meta WHERE key = '${IMPORT_SESSION_OPEN_KEY}';
  INSERT OR REPLACE INTO cohort_summary_meta (key, value)
  VALUES ('is_stale', '0');
`

export const MARK_STALE_SQL = `
  INSERT OR REPLACE INTO cohort_summary_meta (key, value)
  VALUES ('is_stale', '1');
`

/** Check if summary tables exist (for workers on pre-v13 databases) */
export const CHECK_TABLE_EXISTS_SQL =
  "SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name='cohort_variant_summary'"

/**
 * Legacy per-case add of CohortSummaryService.incrementalAdd: counters only
 * for known variants, the case's best row for new ones. Its caller flags the
 * summary stale, so the next rebuild settles the representative.
 */
export const INCREMENTAL_ADD_SQL = `
  INSERT INTO cohort_variant_summary (
    chr, pos, ref, alt, ${REPRESENTATIVE_COLUMNS.join(', ')},
    carrier_count, het_count, hom_count,
    has_star, has_comment, acmg_best,
    variant_key, variant_type, genome_build
  )
  SELECT
    d.chr, d.pos, d.ref, d.alt, ${representativeColumnList('d')},
    1,
    CASE WHEN d.gt_num IN ${HET} THEN 1 ELSE 0 END,
    CASE WHEN d.gt_num IN ${HOM} THEN 1 ELSE 0 END,
    0, 0, NULL,
    d.chr || ':' || d.pos || ':' || d.ref || ':' || d.alt,
    d.variant_type, d.genome_build
  FROM (
    SELECT v.chr, v.pos, v.ref, v.alt, v.variant_type, c.genome_build,
      ${summaryColumnsOverWindow('v', 'case_key', 'sqlite')},
      MAX(v.gt_num) OVER case_key AS gt_num,
      ROW_NUMBER() OVER (case_key ORDER BY ${transcriptOrderBy('v', 'sqlite')}) AS rn
    FROM variants v
    JOIN cases c ON c.id = v.case_id
    WHERE v.case_id = ?
    WINDOW case_key AS (PARTITION BY v.chr, v.pos, v.ref, v.alt, v.variant_type, c.genome_build)
  ) d
  WHERE d.rn = 1
  ON CONFLICT(chr, pos, ref, alt, variant_type, genome_build) DO UPDATE SET
    carrier_count = cohort_variant_summary.carrier_count + 1,
    het_count = cohort_variant_summary.het_count + excluded.het_count,
    hom_count = cohort_variant_summary.hom_count + excluded.hom_count;
`

export const INCREMENTAL_REMOVE_SQL = `
  UPDATE cohort_variant_summary SET
    carrier_count = cohort_variant_summary.carrier_count - 1,
    het_count = cohort_variant_summary.het_count - sub.het_count,
    hom_count = cohort_variant_summary.hom_count - sub.hom_count
  FROM (
    SELECT v.chr, v.pos, v.ref, v.alt, v.variant_type, c.genome_build,
      CASE WHEN MAX(v.gt_num) IN ('0/1','1/0','0|1','1|0') THEN 1 ELSE 0 END AS het_count,
      CASE WHEN MAX(v.gt_num) IN ('1/1','1|1') THEN 1 ELSE 0 END AS hom_count
    FROM variants v
    JOIN cases c ON c.id = v.case_id
    WHERE v.case_id = ?
    GROUP BY v.chr, v.pos, v.ref, v.alt, v.variant_type, c.genome_build
  ) sub
  WHERE cohort_variant_summary.chr = sub.chr
    AND cohort_variant_summary.pos = sub.pos
    AND cohort_variant_summary.ref = sub.ref
    AND cohort_variant_summary.alt = sub.alt
    AND cohort_variant_summary.variant_type = sub.variant_type
    AND cohort_variant_summary.genome_build = sub.genome_build;
`

export const CLEANUP_ZERO_CARRIERS_SQL = `
  DELETE FROM cohort_variant_summary WHERE carrier_count <= 0;
`
