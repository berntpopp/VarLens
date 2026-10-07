/**
 * SQL for the exact per-case cohort-summary add (see cohort-summary-case-add.ts).
 *
 * Every statement is driven by the added case's own rows (`variants.case_id`,
 * served by idx_variants_case_id, which bulk imports keep) plus primary-key
 * probes into the summary tables, so it works while the import worker has the
 * other `variants` indexes dropped.
 */
import { IMPORT_SESSION_OPEN_KEY } from '../../shared/sql/cohort-summary-rebuild'
import {
  REPRESENTATIVE_COLUMNS,
  precedesRepresentative,
  representativeColumnList,
  representativeOrderBy
} from '../../shared/sql/cohort-representative'

export { IMPORT_SESSION_OPEN_KEY }

const HET = "('0/1','1/0','0|1','1|0')"
const HOM = "('1/1','1|1')"

export const SET_IMPORT_SESSION_OPEN_SQL = `
  INSERT OR REPLACE INTO cohort_summary_meta (key, value)
  VALUES ('${IMPORT_SESSION_OPEN_KEY}', '1')`

/**
 * Put the marker back if a full rebuild removed it (UPDATE_META_SQL); one
 * primary-key probe when it is still there. `changes` tells which it was.
 */
export const KEEP_IMPORT_SESSION_OPEN_SQL = `
  INSERT OR IGNORE INTO cohort_summary_meta (key, value)
  VALUES ('${IMPORT_SESSION_OPEN_KEY}', '1')`

export const CLEAR_IMPORT_SESSION_OPEN_SQL = `
  DELETE FROM cohort_summary_meta WHERE key = '${IMPORT_SESSION_OPEN_KEY}'`

export const IS_IMPORT_SESSION_OPEN_SQL = `
  SELECT 1 FROM cohort_summary_meta
  WHERE key = '${IMPORT_SESSION_OPEN_KEY}' AND value = '1'`

/**
 * cohort_variant_summary's declared column types: the staged values must carry
 * the same affinity as the stored ones for the comparison with the stored
 * representative to be the one the full rebuild makes.
 */
const REPRESENTATIVE_COLUMN_TYPES: Record<string, string> = {
  gene_symbol: 'TEXT',
  cdna: 'TEXT',
  aa_change: 'TEXT',
  consequence: 'TEXT',
  func: 'TEXT',
  clinvar: 'TEXT',
  gnomad_af: 'REAL',
  cadd: 'REAL',
  transcript: 'TEXT',
  omim_mim_number: 'TEXT',
  end_pos: 'INTEGER',
  impact_rank: 'INTEGER NOT NULL',
  clinvar_rank: 'INTEGER NOT NULL'
}

export const CASE_ADD_TEMP_TABLES_SQL = `
  CREATE TEMP TABLE IF NOT EXISTS added_case_gene_coords (
    gene_symbol TEXT NOT NULL, chr TEXT NOT NULL, pos INTEGER NOT NULL,
    ref TEXT NOT NULL, alt TEXT NOT NULL,
    row_count INTEGER NOT NULL, state INTEGER NOT NULL
  );
  CREATE TEMP TABLE IF NOT EXISTS added_case_coords (
    chr TEXT NOT NULL, pos INTEGER NOT NULL, ref TEXT NOT NULL, alt TEXT NOT NULL,
    variant_type TEXT NOT NULL,
    ${REPRESENTATIVE_COLUMNS.map((col) => `${col} ${REPRESENTATIVE_COLUMN_TYPES[col]}`).join(', ')},
    het INTEGER NOT NULL, hom INTEGER NOT NULL, summary_rowid INTEGER
  );
  CREATE TEMP TABLE IF NOT EXISTS replaced_case_flag_coords (
    chr TEXT NOT NULL, pos INTEGER NOT NULL, ref TEXT NOT NULL, alt TEXT NOT NULL,
    PRIMARY KEY (chr, pos, ref, alt)
  ) WITHOUT ROWID;
`

/** `state` of a (gene, coordinate) pair of the added case. */
export const GENE_COORD_KNOWN = 0
export const GENE_COORD_NEW = 1
export const GENE_COORD_UNRESOLVED = 2

const SUMMARY_HAS_COORD = `SELECT 1 FROM cohort_variant_summary s
        WHERE s.chr = v.chr AND s.pos = v.pos AND s.ref = v.ref AND s.alt = v.alt
          AND s.genome_build = @build`

/**
 * The case's distinct (gene, coordinate) pairs with their row counts. Must run
 * BEFORE the case is merged into cohort_variant_summary: the summary then still
 * describes the other cases only, and classifies each pair without touching
 * their variants —
 *  - no summary row at the coordinate (in this build): nobody else carries it,
 *    so it is a new unique variant for the gene;
 *  - a summary row whose gene_symbol (that of its representative carrier row)
 *    equals the gene: some other row has this gene at this coordinate, so it
 *    is known;
 *  - otherwise the coordinate's representative has a different gene and only the
 *    variants themselves can tell (resolved by RESOLVE_GENE_COORDS_SQL).
 */
export const CAPTURE_GENE_COORDS_SQL = `
  INSERT INTO temp.added_case_gene_coords
  SELECT v.gene_symbol, v.chr, v.pos, v.ref, v.alt, COUNT(*),
    CASE
      WHEN EXISTS (${SUMMARY_HAS_COORD} AND s.gene_symbol = v.gene_symbol)
        THEN ${GENE_COORD_KNOWN}
      WHEN EXISTS (${SUMMARY_HAS_COORD}) THEN ${GENE_COORD_UNRESOLVED}
      ELSE ${GENE_COORD_NEW}
    END
  FROM variants v
  WHERE v.case_id = @caseId AND v.gene_symbol IS NOT NULL AND v.gene_symbol != ''
  GROUP BY v.gene_symbol, v.chr, v.pos, v.ref, v.alt`

export const COUNT_UNRESOLVED_GENE_COORDS_SQL = `
  SELECT COUNT(*) AS c FROM temp.added_case_gene_coords WHERE state = ${GENE_COORD_UNRESOLVED}`

/** Needs idx_variants_chr_pos_ref_alt; the caller ensures it exists first. */
export const RESOLVE_GENE_COORDS_SQL = `
  UPDATE temp.added_case_gene_coords SET state = CASE WHEN EXISTS (
      SELECT 1 FROM variants r JOIN cases rc ON rc.id = r.case_id AND rc.import_status = 'ready'
      WHERE r.chr = added_case_gene_coords.chr AND r.pos = added_case_gene_coords.pos
        AND r.ref = added_case_gene_coords.ref AND r.alt = added_case_gene_coords.alt
        AND r.gene_symbol = added_case_gene_coords.gene_symbol
        AND r.case_id != @caseId AND rc.genome_build = @build
    ) THEN ${GENE_COORD_KNOWN} ELSE ${GENE_COORD_NEW} END
  WHERE state = ${GENE_COORD_UNRESOLVED}`

export const UPSERT_GENE_BURDEN_SQL = `
  INSERT INTO gene_burden_summary (
    gene_symbol, variant_count, unique_variant_count,
    affected_case_count, updated_at, genome_build
  )
  SELECT gene_symbol, SUM(row_count), SUM(state), 1,
    CAST(strftime('%s', 'now') AS INTEGER), @build
  FROM temp.added_case_gene_coords
  WHERE true
  GROUP BY gene_symbol
  ON CONFLICT(gene_symbol, genome_build) DO UPDATE SET
    variant_count = variant_count + excluded.variant_count,
    unique_variant_count = unique_variant_count + excluded.unique_variant_count,
    affected_case_count = affected_case_count + 1,
    updated_at = excluded.updated_at`

/**
 * The rebuild's per-case step for the added case, computed ONCE: per
 * coordinate and type its best row by the representative order (#469) and its
 * genotype, together with the rowid of the summary row it lands on (NULL: no
 * case had this variant yet). All three merge statements below are driven by
 * it, so the case's variants are ranked once and the summary's primary key is
 * probed once per coordinate.
 */
export const CAPTURE_CASE_COORDS_SQL = `
  INSERT INTO temp.added_case_coords (
    chr, pos, ref, alt, variant_type, ${REPRESENTATIVE_COLUMNS.join(', ')}, het, hom, summary_rowid
  )
  SELECT d.chr, d.pos, d.ref, d.alt, d.variant_type,
    ${representativeColumnList('d')},
    CASE WHEN d.gt_num IN ${HET} THEN 1 ELSE 0 END,
    CASE WHEN d.gt_num IN ${HOM} THEN 1 ELSE 0 END,
    s.rowid
  FROM (
    SELECT v.chr, v.pos, v.ref, v.alt, v.variant_type,
      ${representativeColumnList('v')},
      MAX(v.gt_num) OVER case_key AS gt_num,
      ROW_NUMBER() OVER (case_key ORDER BY ${representativeOrderBy('v', 'sqlite')}) AS rn
    FROM variants v
    WHERE v.case_id = @caseId
    WINDOW case_key AS (PARTITION BY v.chr, v.pos, v.ref, v.alt, v.variant_type)
  ) d
  LEFT JOIN cohort_variant_summary s
    ON s.chr = d.chr AND s.pos = d.pos AND s.ref = d.ref AND s.alt = d.alt
    AND s.variant_type = d.variant_type AND s.genome_build = @build
  WHERE d.rn = 1`

/**
 * Step 1 of the merge: carrier/het/hom += the case's contribution on the rows
 * that already exist. Kept apart from the representative merge because SQLite
 * rewrites every index that covers a column in the SET list whether or not
 * the value changes — most carriers of a known variant are not more severe
 * than the stored row, and this way they only touch the indexes that contain
 * carrier_count.
 */
export const INCREMENT_CARRIERS_SQL = `
  UPDATE cohort_variant_summary SET
    carrier_count = carrier_count + 1,
    het_count = het_count + d.het,
    hom_count = hom_count + d.hom
  FROM temp.added_case_coords d
  WHERE cohort_variant_summary.rowid = d.summary_rowid`

/**
 * Step 2: the case's row replaces the stored representative, in every column
 * at once, only where it precedes it in the representative order.
 */
export const MERGE_REPRESENTATIVE_SQL = `
  UPDATE cohort_variant_summary SET
    ${REPRESENTATIVE_COLUMNS.map((col) => `${col} = d.${col}`).join(',\n    ')}
  FROM temp.added_case_coords d
  WHERE cohort_variant_summary.rowid = d.summary_rowid
    AND ${precedesRepresentative('d', 'cohort_variant_summary', 'sqlite')}`

/**
 * Step 3: the variants no case had yet become new rows — 1 carrier, flags
 * from variant_annotations like the rebuild's LEFT JOIN.
 */
export const INSERT_NEW_VARIANT_SUMMARY_SQL = `
  INSERT INTO cohort_variant_summary (
    chr, pos, ref, alt, variant_type, genome_build, variant_key,
    ${REPRESENTATIVE_COLUMNS.join(', ')},
    carrier_count, het_count, hom_count, has_star, has_comment, acmg_best
  )
  SELECT d.chr, d.pos, d.ref, d.alt, d.variant_type, @build,
    d.chr || ':' || d.pos || ':' || d.ref || ':' || d.alt,
    ${representativeColumnList('d')},
    1, d.het, d.hom,
    CASE WHEN va.starred = 1 THEN 1 ELSE 0 END,
    CASE WHEN va.global_comment IS NOT NULL AND va.global_comment != '' THEN 1 ELSE 0 END,
    va.acmg_classification
  FROM temp.added_case_coords d
  LEFT JOIN variant_annotations va
    ON va.chr = d.chr AND va.pos = d.pos AND va.ref = d.ref AND va.alt = d.alt
  WHERE d.summary_rowid IS NULL`

/** Coordinates the case about to be replaced has per-case annotations on. */
export const CAPTURE_REPLACED_FLAG_COORDS_SQL = `
  INSERT OR IGNORE INTO temp.replaced_case_flag_coords
  SELECT v.chr, v.pos, v.ref, v.alt
  FROM case_variant_annotations cva
  JOIN variants v ON v.id = cva.variant_id
  WHERE cva.case_id = ?`

/**
 * Reset the flags at those coordinates to their variant_annotations base (the
 * rebuild's LEFT JOIN); UPDATE_PER_CASE_ANNOTATION_FLAGS_SQL then re-applies
 * what the remaining cases' per-case annotations still contribute.
 */
export const RESET_REPLACED_FLAGS_SQL = `
  UPDATE cohort_variant_summary SET
    has_star = COALESCE((SELECT va.starred = 1 FROM variant_annotations va
      WHERE va.chr = cohort_variant_summary.chr AND va.pos = cohort_variant_summary.pos
        AND va.ref = cohort_variant_summary.ref AND va.alt = cohort_variant_summary.alt), 0),
    has_comment = COALESCE((SELECT va.global_comment IS NOT NULL AND va.global_comment != ''
      FROM variant_annotations va
      WHERE va.chr = cohort_variant_summary.chr AND va.pos = cohort_variant_summary.pos
        AND va.ref = cohort_variant_summary.ref AND va.alt = cohort_variant_summary.alt), 0),
    acmg_best = (SELECT va.acmg_classification FROM variant_annotations va
      WHERE va.chr = cohort_variant_summary.chr AND va.pos = cohort_variant_summary.pos
        AND va.ref = cohort_variant_summary.ref AND va.alt = cohort_variant_summary.alt)
  WHERE (chr, pos, ref, alt) IN
    (SELECT chr, pos, ref, alt FROM temp.replaced_case_flag_coords)`

export const HAS_PER_CASE_ANNOTATIONS_SQL = 'SELECT 1 FROM case_variant_annotations LIMIT 1'

/** Bulk imports drop this index; overwrites and unresolved gene pairs need it. */
export const ENSURE_COORD_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS idx_variants_chr_pos_ref_alt ON variants(chr, pos, ref, alt)'
