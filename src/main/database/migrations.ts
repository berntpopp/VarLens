/**
 * Database migrations for Varlens
 *
 * Uses PRAGMA user_version to track schema version and apply migrations atomically.
 * Migrations are idempotent and safe for both plaintext and encrypted databases.
 */

import type Database from 'better-sqlite3-multiple-ciphers'
import { CLINICAL_METRICS } from './clinical-metrics'
import { BUILT_IN_PRESETS } from './built-in-presets'

/**
 * Run schema migrations based on PRAGMA user_version
 *
 * IMPORTANT: This function must be called AFTER PRAGMA key is issued for encrypted databases.
 * The encryption key must be set before any database operations, including version checks.
 *
 * Version history:
 * - 0 (implicit): Initial v0.3.0 schema (cases, variants, FTS)
 * - 1: Mark existing v0.3.0 databases
 * - 2: v0.4.0 annotation tables (tags, cohorts, HPO terms, case metadata)
 * - 3: v0.4.0 schema fix (move starred/ACMG to per-case annotations)
 * - 4: v0.15.0 add sex column to case_metadata
 * - 5: v0.16.0 performance indexes
 * - 6: v0.17.0 case comments and metrics tables
 * - 7: v0.18.0 audit trail table
 * - 8: v0.20.0 add age and date_of_birth to case_metadata
 * - 9: v0.21.0 case_data_info table (import provenance, platform, pre-filtering)
 * - 10: v0.21.0 gene_lists and gene_list_items tables (curated reusable gene lists)
 * - 11: v0.21.0 remove non-clinical predefined metrics (genetics, QC, variant stats)
 * - 15: Filter presets table with built-in preset seeding
 * - 16: Rework built-in presets to clinical combo presets
 * - 17: Performance indexes for tag/star/ACMG filter queries
 * - 18: Composite index on variant_annotations for coordinate lookups
 * - 19: panels, panel_genes, case_active_panels + cases.genome_build
 * - 20: variant_frequency table for internal AF tracking (#106)
 * - 21: analysis_groups + analysis_group_members for family/trio support (#107)
 * - 22: Cross-case variant coordinate index for trio inheritance queries (#107)
 * - 23: VCF import columns on variants + cases (#42)
 * - 24: Normalize ACMG classification labels to ClinVar sentence case
 * - 25: Multi-variant type support (SV/CNV/STR extension tables, case_import_files)
 *
 * @param db - better-sqlite3-multiple-ciphers Database instance
 */
export function runMigrations(db: Database.Database): void {
  const result = db.prepare('PRAGMA user_version').get() as { user_version: number }
  const currentVersion = result.user_version

  // v0.3.0 baseline - existing databases have no version set
  if (currentVersion < 1) {
    // Mark existing v0.3.0 schema as version 1
    db.exec('PRAGMA user_version = 1')
  }

  // v0.4.0 annotation tables
  if (currentVersion < 2) {
    db.exec(`
      -- Global variant annotations (keyed by chr:pos:ref:alt)
      CREATE TABLE IF NOT EXISTS variant_annotations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chr TEXT NOT NULL,
        pos INTEGER NOT NULL,
        ref TEXT NOT NULL,
        alt TEXT NOT NULL,
        global_comment TEXT,
        starred INTEGER NOT NULL DEFAULT 0,
        acmg_classification TEXT,
        acmg_evidence TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(chr, pos, ref, alt)
      );

      CREATE INDEX IF NOT EXISTS idx_variant_annotations_coords
        ON variant_annotations(chr, pos, ref, alt);

      CREATE INDEX IF NOT EXISTS idx_variant_annotations_starred
        ON variant_annotations(starred) WHERE starred = 1;

      -- Per-case variant annotations
      CREATE TABLE IF NOT EXISTS case_variant_annotations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER NOT NULL,
        variant_id INTEGER NOT NULL,
        per_case_comment TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
        FOREIGN KEY (variant_id) REFERENCES variants(id) ON DELETE CASCADE,
        UNIQUE(case_id, variant_id)
      );

      CREATE INDEX IF NOT EXISTS idx_case_variant_annotations_case
        ON case_variant_annotations(case_id);

      CREATE INDEX IF NOT EXISTS idx_case_variant_annotations_variant
        ON case_variant_annotations(variant_id);

      -- Case metadata (status and notes)
      CREATE TABLE IF NOT EXISTS case_metadata (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER NOT NULL,
        affected_status TEXT,
        notes TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
        UNIQUE(case_id)
      );

      CREATE INDEX IF NOT EXISTS idx_case_metadata_case
        ON case_metadata(case_id);

      -- Cohort groups
      CREATE TABLE IF NOT EXISTS cohort_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        created_at INTEGER NOT NULL
      );

      -- Case-cohort junction table
      CREATE TABLE IF NOT EXISTS case_cohort_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER NOT NULL,
        cohort_id INTEGER NOT NULL,
        FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
        FOREIGN KEY (cohort_id) REFERENCES cohort_groups(id) ON DELETE CASCADE,
        UNIQUE(case_id, cohort_id)
      );

      CREATE INDEX IF NOT EXISTS idx_case_cohort_links_case
        ON case_cohort_links(case_id);

      CREATE INDEX IF NOT EXISTS idx_case_cohort_links_cohort
        ON case_cohort_links(cohort_id);

      -- API cache for VEP/HPO responses
      CREATE TABLE IF NOT EXISTS api_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cache_key TEXT NOT NULL UNIQUE,
        response_data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_api_cache_key
        ON api_cache(cache_key);

      CREATE INDEX IF NOT EXISTS idx_api_cache_expires
        ON api_cache(expires_at);

      -- Custom tags
      CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        color TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      -- Per-case tag assignments
      CREATE TABLE IF NOT EXISTS variant_tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER NOT NULL,
        variant_id INTEGER NOT NULL,
        tag_id INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
        FOREIGN KEY (variant_id) REFERENCES variants(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
        UNIQUE(case_id, variant_id, tag_id)
      );

      CREATE INDEX IF NOT EXISTS idx_variant_tags_case
        ON variant_tags(case_id);

      CREATE INDEX IF NOT EXISTS idx_variant_tags_variant
        ON variant_tags(variant_id);

      CREATE INDEX IF NOT EXISTS idx_variant_tags_tag
        ON variant_tags(tag_id);

      -- HPO term assignments to cases
      CREATE TABLE IF NOT EXISTS case_hpo_terms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER NOT NULL,
        hpo_id TEXT NOT NULL,
        hpo_label TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
        UNIQUE(case_id, hpo_id)
      );

      CREATE INDEX IF NOT EXISTS idx_case_hpo_terms_case
        ON case_hpo_terms(case_id);

      CREATE INDEX IF NOT EXISTS idx_case_hpo_terms_hpo
        ON case_hpo_terms(hpo_id);
    `)

    // Update version to 2
    db.exec('PRAGMA user_version = 2')
  }

  // v0.4.0 schema fix: Move starred and ACMG to per-case
  if (currentVersion < 3) {
    db.exec(`
      -- Add starred and ACMG columns to case_variant_annotations (per-case)
      ALTER TABLE case_variant_annotations ADD COLUMN starred INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE case_variant_annotations ADD COLUMN acmg_classification TEXT;
      ALTER TABLE case_variant_annotations ADD COLUMN acmg_evidence TEXT;

      -- Create index for starred filter
      CREATE INDEX IF NOT EXISTS idx_case_variant_annotations_starred
        ON case_variant_annotations(starred) WHERE starred = 1;
    `)

    // Update version to 3
    db.exec('PRAGMA user_version = 3')
  }

  // v0.15.0: Add sex column to case_metadata
  if (currentVersion < 4) {
    // Check if column already exists (safety for partial migrations)
    const columns = db.prepare('PRAGMA table_info(case_metadata)').all() as { name: string }[]
    const hasSex = columns.some((c) => c.name === 'sex')

    if (!hasSex) {
      db.exec(`ALTER TABLE case_metadata ADD COLUMN sex TEXT DEFAULT 'unknown'`)
    }

    db.exec('PRAGMA user_version = 4')
  }

  // v0.16.0: Performance indexes
  if (currentVersion < 5) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_variants_filter_covering
        ON variants(case_id, consequence, func, clinvar);

      CREATE INDEX IF NOT EXISTS idx_variants_case_coords
        ON variants(case_id, chr, pos, ref, alt);

      CREATE INDEX IF NOT EXISTS idx_variants_gene_notnull
        ON variants(gene_symbol) WHERE gene_symbol IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_variant_annotations_acmg
        ON variant_annotations(acmg_classification) WHERE acmg_classification IS NOT NULL;
    `)
    db.exec('PRAGMA user_version = 5')
  }

  // v0.17.0: Add case comments and metrics tables
  if (currentVersion < 6) {
    db.exec(`
      -- Case comments (timestamped, categorized)
      CREATE TABLE IF NOT EXISTS case_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER NOT NULL,
        category TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER,
        FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_case_comments_case_created
        ON case_comments(case_id, created_at);

      CREATE INDEX IF NOT EXISTS idx_case_comments_case_category
        ON case_comments(case_id, category);

      -- Metric definitions (predefined + user-created catalog)
      CREATE TABLE IF NOT EXISTS metric_definitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        value_type TEXT NOT NULL,
        unit TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL,
        is_predefined INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      -- Case metric values (EAV pattern with typed columns)
      CREATE TABLE IF NOT EXISTS case_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER NOT NULL,
        metric_id INTEGER NOT NULL,
        numeric_value REAL,
        text_value TEXT,
        date_value TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
        FOREIGN KEY (metric_id) REFERENCES metric_definitions(id) ON DELETE CASCADE,
        UNIQUE(case_id, metric_id)
      );

      CREATE INDEX IF NOT EXISTS idx_case_metrics_case
        ON case_metrics(case_id);

      CREATE INDEX IF NOT EXISTS idx_case_metrics_metric
        ON case_metrics(metric_id);
    `)

    // Seed predefined metric definitions
    const now = Date.now()
    const insertMetric = db.prepare(
      'INSERT OR IGNORE INTO metric_definitions (name, value_type, unit, category, is_predefined, created_at) VALUES (?, ?, ?, ?, 1, ?)'
    )

    const seedTransaction = db.transaction(() => {
      for (const metric of CLINICAL_METRICS) {
        insertMetric.run(metric.name, metric.value_type, metric.unit, metric.category, now)
      }
    })
    seedTransaction()

    db.exec('PRAGMA user_version = 6')
  }

  // Version 6 → 7: Audit trail table (issue #39)
  if (currentVersion < 7) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        action_type TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_key TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        user_name TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_audit_log_entity_key
        ON audit_log(entity_key);

      CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp
        ON audit_log(timestamp);

      CREATE INDEX IF NOT EXISTS idx_audit_log_action_type
        ON audit_log(action_type);
    `)

    db.exec('PRAGMA user_version = 7')
  }

  // Version 7 → 8: Add age and date_of_birth to case_metadata (gene burden analysis)
  if (currentVersion < 8) {
    const columns = db.prepare('PRAGMA table_info(case_metadata)').all() as { name: string }[]
    const hasAge = columns.some((c) => c.name === 'age')
    const hasDob = columns.some((c) => c.name === 'date_of_birth')

    if (!hasAge) {
      db.exec(`ALTER TABLE case_metadata ADD COLUMN age REAL`)
    }
    if (!hasDob) {
      db.exec(`ALTER TABLE case_metadata ADD COLUMN date_of_birth TEXT`)
    }

    db.exec('PRAGMA user_version = 8')
  }

  // Version 8 → 9: Case data info table (import provenance, platform, pre-filtering)
  if (currentVersion < 9) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS case_data_info (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER NOT NULL UNIQUE,
        import_file_name TEXT,
        import_file_type TEXT,
        platform TEXT,
        platform_details TEXT,
        af_filter TEXT,
        gene_list_filter TEXT,
        region_filter TEXT,
        quality_filter TEXT,
        data_notes TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_case_data_info_case
        ON case_data_info(case_id);

      -- External IDs: user-defined key-value pairs for cross-referencing
      CREATE TABLE IF NOT EXISTS case_external_ids (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER NOT NULL,
        id_type TEXT NOT NULL,
        id_value TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
        UNIQUE(case_id, id_type)
      );

      CREATE INDEX IF NOT EXISTS idx_case_external_ids_case
        ON case_external_ids(case_id);
    `)

    // Auto-populate for existing cases from cases.file_path
    const existingCases = db.prepare('SELECT id, file_path, created_at FROM cases').all() as Array<{
      id: number
      file_path: string
      created_at: number
    }>

    const insertInfo = db.prepare(
      'INSERT OR IGNORE INTO case_data_info (case_id, import_file_name, created_at, updated_at) VALUES (?, ?, ?, ?)'
    )
    const now = Date.now()
    for (const c of existingCases) {
      // Extract basename from file_path
      const parts = c.file_path.split(/[/\\]/)
      const fileName = parts[parts.length - 1] || c.file_path
      insertInfo.run(c.id, fileName, c.created_at || now, now)
    }

    db.exec('PRAGMA user_version = 9')
  }

  // Version 9 → 10: Curated gene lists and BED region files
  if (currentVersion < 10) {
    db.exec(`
      -- Reusable gene lists
      CREATE TABLE IF NOT EXISTS gene_lists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS gene_list_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        gene_list_id INTEGER NOT NULL,
        gene_symbol TEXT NOT NULL,
        FOREIGN KEY (gene_list_id) REFERENCES gene_lists(id) ON DELETE CASCADE,
        UNIQUE(gene_list_id, gene_symbol)
      );

      CREATE INDEX IF NOT EXISTS idx_gene_list_items_list
        ON gene_list_items(gene_list_id);

      -- BED region files (stored content)
      CREATE TABLE IF NOT EXISTS region_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        region_count INTEGER NOT NULL DEFAULT 0,
        total_bases INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS region_file_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        region_file_id INTEGER NOT NULL,
        chr TEXT NOT NULL,
        start_pos INTEGER NOT NULL,
        end_pos INTEGER NOT NULL,
        label TEXT,
        FOREIGN KEY (region_file_id) REFERENCES region_files(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_region_file_entries_file
        ON region_file_entries(region_file_id);
    `)

    // Add columns to case_data_info idempotently (guard against partial migrations)
    const dataInfoCols = db.prepare('PRAGMA table_info(case_data_info)').all() as { name: string }[]
    if (!dataInfoCols.some((c) => c.name === 'gene_list_id')) {
      db.exec(
        'ALTER TABLE case_data_info ADD COLUMN gene_list_id INTEGER REFERENCES gene_lists(id) ON DELETE SET NULL'
      )
    }
    if (!dataInfoCols.some((c) => c.name === 'region_file_id')) {
      db.exec(
        'ALTER TABLE case_data_info ADD COLUMN region_file_id INTEGER REFERENCES region_files(id) ON DELETE SET NULL'
      )
    }

    db.exec('PRAGMA user_version = 10')
  }

  // ── Migration v11: Remove non-clinical predefined metrics ──
  if (currentVersion < 11) {
    // Remove genetics/genomics metrics and other non-clinical entries
    // that don't belong in a clinical lab metrics catalog.
    // Only deletes predefined entries (is_predefined = 1) that have no user data.
    // Comprehensive list: genetics/genomics, variant stats, bioinformatics QC,
    // redundant demographics (DOB now in overview), and non-clinical scores.
    const removableMetrics = [
      // Genetics / Genomics
      'Diagnostic Yield',
      'Karyotype',
      'ACMG Classification',
      'ACMG Pathogenic Count',
      'ACMG Likely Pathogenic Count',
      'ACMG VUS Count',
      // Variant statistics (computable from data)
      'SNV Count',
      'Indel Count',
      'Total Variant Count',
      'HPO Term Count',
      'Ti/Tv Ratio',
      // Bioinformatics QC
      'Mean Coverage',
      'Median Coverage',
      'Coverage at 10x',
      'Coverage at 20x',
      'Coverage at 30x',
      'Percent Bases Above 10x',
      'Percent Bases Above 20x',
      'Percent Bases Above 30x',
      'Mean Insert Size',
      'Duplication Rate',
      'Mapping Rate',
      'GC Content',
      'Total Reads',
      'Mapped Reads',
      'On-Target Rate',
      'Uniformity of Coverage',
      // Redundant (now in Overview tab)
      'Date of Birth',
      // Non-clinical scores
      'APGAR Score (1 min)',
      'APGAR Score (5 min)',
      'Glasgow Coma Scale (GCS)',
      'Pain Score (VAS)',
      'Family History'
    ]

    const deleteUnused = db.prepare(
      `DELETE FROM metric_definitions
       WHERE name = ? AND is_predefined = 1
       AND id NOT IN (SELECT metric_id FROM case_metrics)`
    )

    const cleanupTransaction = db.transaction(() => {
      for (const name of removableMetrics) {
        deleteUnused.run(name)
      }
    })
    cleanupTransaction()

    db.exec('PRAGMA user_version = 11')
  }

  // ── Migration v12: Users and database_settings tables ──
  if (currentVersion < 12) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user')),
        is_active INTEGER NOT NULL DEFAULT 1,
        must_change_password INTEGER NOT NULL DEFAULT 0,
        failed_login_count INTEGER NOT NULL DEFAULT 0,
        locked_until TEXT,
        password_changed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        created_by INTEGER REFERENCES users(id),
        updated_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_users_username
        ON users(username);

      CREATE TABLE IF NOT EXISTS database_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)

    db.exec('PRAGMA user_version = 12')
  }

  // ── Migration v13: Cohort summary tables (issue #33) ──
  if (currentVersion < 13) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS cohort_variant_summary (
        chr TEXT NOT NULL,
        pos INTEGER NOT NULL,
        ref TEXT NOT NULL,
        alt TEXT NOT NULL,
        gene_symbol TEXT,
        cdna TEXT,
        aa_change TEXT,
        consequence TEXT,
        func TEXT,
        clinvar TEXT,
        gnomad_af REAL,
        cadd REAL,
        transcript TEXT,
        omim_mim_number TEXT,
        carrier_count INTEGER NOT NULL,
        het_count INTEGER NOT NULL,
        hom_count INTEGER NOT NULL,
        variant_key TEXT NOT NULL,
        PRIMARY KEY (chr, pos, ref, alt)
      );

      CREATE INDEX IF NOT EXISTS idx_cvs_gene ON cohort_variant_summary(gene_symbol);
      CREATE INDEX IF NOT EXISTS idx_cvs_carrier ON cohort_variant_summary(carrier_count);
      CREATE INDEX IF NOT EXISTS idx_cvs_filters ON cohort_variant_summary(gnomad_af, cadd);
      CREATE INDEX IF NOT EXISTS idx_cvs_consequence ON cohort_variant_summary(consequence);

      CREATE TABLE IF NOT EXISTS gene_burden_summary (
        gene_symbol TEXT PRIMARY KEY,
        variant_count INTEGER NOT NULL,
        unique_variant_count INTEGER NOT NULL,
        affected_case_count INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_gbs_affected
        ON gene_burden_summary(affected_case_count DESC);

      CREATE TABLE IF NOT EXISTS cohort_summary_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)

    db.exec('PRAGMA user_version = 13')
  }

  // ── Migration v14: Cohort performance optimization ──
  if (currentVersion < 14) {
    // Denormalized annotation flags (idempotent — check before adding)
    const cvsCols = db.prepare('PRAGMA table_info(cohort_variant_summary)').all() as {
      name: string
    }[]
    const cvsColNames = new Set(cvsCols.map((c) => c.name))
    if (!cvsColNames.has('has_star')) {
      db.exec('ALTER TABLE cohort_variant_summary ADD COLUMN has_star INTEGER NOT NULL DEFAULT 0')
    }
    if (!cvsColNames.has('has_comment')) {
      db.exec(
        'ALTER TABLE cohort_variant_summary ADD COLUMN has_comment INTEGER NOT NULL DEFAULT 0'
      )
    }
    if (!cvsColNames.has('acmg_best')) {
      db.exec('ALTER TABLE cohort_variant_summary ADD COLUMN acmg_best TEXT')
    }
    if (!cvsColNames.has('cohort_frequency')) {
      db.exec('ALTER TABLE cohort_variant_summary ADD COLUMN cohort_frequency REAL')
    }

    // Index for frequency filter
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_cvs_cohort_freq
        ON cohort_variant_summary(cohort_frequency);
    `)

    // Backfill cohort_frequency for existing rows (skip if already populated)
    const needsBackfill = db
      .prepare(
        'SELECT 1 FROM cohort_variant_summary WHERE cohort_frequency IS NULL AND carrier_count > 0 LIMIT 1'
      )
      .get()
    if (needsBackfill !== undefined) {
      db.exec(`
        UPDATE cohort_variant_summary
        SET cohort_frequency = CAST(carrier_count AS REAL) / NULLIF((SELECT COUNT(*) FROM cases), 0)
        WHERE cohort_frequency IS NULL;
      `)
    }

    // Mark stale to trigger full rebuild (populates annotation flags)
    db.exec(`
      INSERT OR REPLACE INTO cohort_summary_meta (key, value)
      VALUES ('is_stale', '1');
    `)

    // ── AFTER triggers: keep has_star, has_comment, acmg_best in sync ──

    // Helper: the UPDATE body that recomputes flags from both annotation tables.
    // Parameterized by the column prefix used to identify the variant (NEW or OLD).

    // --- variant_annotations triggers ---

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_va_after_insert
      AFTER INSERT ON variant_annotations
      FOR EACH ROW
      BEGIN
        UPDATE cohort_variant_summary SET
          has_star = (
            SELECT CASE WHEN EXISTS(
              SELECT 1 FROM variant_annotations va
              WHERE va.chr = NEW.chr AND va.pos = NEW.pos AND va.ref = NEW.ref AND va.alt = NEW.alt AND va.starred = 1
            ) OR EXISTS(
              SELECT 1 FROM case_variant_annotations cva
              JOIN variants v ON cva.variant_id = v.id
              WHERE v.chr = NEW.chr AND v.pos = NEW.pos AND v.ref = NEW.ref AND v.alt = NEW.alt AND cva.starred = 1
            ) THEN 1 ELSE 0 END
          ),
          has_comment = (
            SELECT CASE WHEN EXISTS(
              SELECT 1 FROM variant_annotations va
              WHERE va.chr = NEW.chr AND va.pos = NEW.pos AND va.ref = NEW.ref AND va.alt = NEW.alt
              AND va.global_comment IS NOT NULL AND va.global_comment != ''
            ) OR EXISTS(
              SELECT 1 FROM case_variant_annotations cva
              JOIN variants v ON cva.variant_id = v.id
              WHERE v.chr = NEW.chr AND v.pos = NEW.pos AND v.ref = NEW.ref AND v.alt = NEW.alt
              AND cva.per_case_comment IS NOT NULL AND cva.per_case_comment != ''
            ) THEN 1 ELSE 0 END
          ),
          acmg_best = (
            SELECT CASE MAX(rank) WHEN 5 THEN 'Pathogenic' WHEN 4 THEN 'Likely pathogenic'
              WHEN 3 THEN 'Uncertain significance' WHEN 2 THEN 'Likely benign'
              WHEN 1 THEN 'Benign' ELSE NULL END
            FROM (
              SELECT CASE va.acmg_classification
                WHEN 'Pathogenic' THEN 5 WHEN 'Likely pathogenic' THEN 4
                WHEN 'Uncertain significance' THEN 3 WHEN 'Likely benign' THEN 2
                WHEN 'Benign' THEN 1 ELSE 0 END AS rank
              FROM variant_annotations va
              WHERE va.chr = NEW.chr AND va.pos = NEW.pos AND va.ref = NEW.ref AND va.alt = NEW.alt
              AND va.acmg_classification IS NOT NULL
              UNION ALL
              SELECT CASE cva.acmg_classification
                WHEN 'Pathogenic' THEN 5 WHEN 'Likely pathogenic' THEN 4
                WHEN 'Uncertain significance' THEN 3 WHEN 'Likely benign' THEN 2
                WHEN 'Benign' THEN 1 ELSE 0 END
              FROM case_variant_annotations cva
              JOIN variants v ON cva.variant_id = v.id
              WHERE v.chr = NEW.chr AND v.pos = NEW.pos AND v.ref = NEW.ref AND v.alt = NEW.alt
              AND cva.acmg_classification IS NOT NULL
            )
          )
        WHERE chr = NEW.chr AND pos = NEW.pos AND ref = NEW.ref AND alt = NEW.alt;
      END
    `)

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_va_after_update
      AFTER UPDATE ON variant_annotations
      FOR EACH ROW
      WHEN OLD.starred != NEW.starred
        OR OLD.global_comment IS NOT NEW.global_comment
        OR OLD.acmg_classification IS NOT NEW.acmg_classification
      BEGIN
        UPDATE cohort_variant_summary SET
          has_star = (
            SELECT CASE WHEN EXISTS(
              SELECT 1 FROM variant_annotations va
              WHERE va.chr = NEW.chr AND va.pos = NEW.pos AND va.ref = NEW.ref AND va.alt = NEW.alt AND va.starred = 1
            ) OR EXISTS(
              SELECT 1 FROM case_variant_annotations cva
              JOIN variants v ON cva.variant_id = v.id
              WHERE v.chr = NEW.chr AND v.pos = NEW.pos AND v.ref = NEW.ref AND v.alt = NEW.alt AND cva.starred = 1
            ) THEN 1 ELSE 0 END
          ),
          has_comment = (
            SELECT CASE WHEN EXISTS(
              SELECT 1 FROM variant_annotations va
              WHERE va.chr = NEW.chr AND va.pos = NEW.pos AND va.ref = NEW.ref AND va.alt = NEW.alt
              AND va.global_comment IS NOT NULL AND va.global_comment != ''
            ) OR EXISTS(
              SELECT 1 FROM case_variant_annotations cva
              JOIN variants v ON cva.variant_id = v.id
              WHERE v.chr = NEW.chr AND v.pos = NEW.pos AND v.ref = NEW.ref AND v.alt = NEW.alt
              AND cva.per_case_comment IS NOT NULL AND cva.per_case_comment != ''
            ) THEN 1 ELSE 0 END
          ),
          acmg_best = (
            SELECT CASE MAX(rank) WHEN 5 THEN 'Pathogenic' WHEN 4 THEN 'Likely pathogenic'
              WHEN 3 THEN 'Uncertain significance' WHEN 2 THEN 'Likely benign'
              WHEN 1 THEN 'Benign' ELSE NULL END
            FROM (
              SELECT CASE va.acmg_classification
                WHEN 'Pathogenic' THEN 5 WHEN 'Likely pathogenic' THEN 4
                WHEN 'Uncertain significance' THEN 3 WHEN 'Likely benign' THEN 2
                WHEN 'Benign' THEN 1 ELSE 0 END AS rank
              FROM variant_annotations va
              WHERE va.chr = NEW.chr AND va.pos = NEW.pos AND va.ref = NEW.ref AND va.alt = NEW.alt
              AND va.acmg_classification IS NOT NULL
              UNION ALL
              SELECT CASE cva.acmg_classification
                WHEN 'Pathogenic' THEN 5 WHEN 'Likely pathogenic' THEN 4
                WHEN 'Uncertain significance' THEN 3 WHEN 'Likely benign' THEN 2
                WHEN 'Benign' THEN 1 ELSE 0 END
              FROM case_variant_annotations cva
              JOIN variants v ON cva.variant_id = v.id
              WHERE v.chr = NEW.chr AND v.pos = NEW.pos AND v.ref = NEW.ref AND v.alt = NEW.alt
              AND cva.acmg_classification IS NOT NULL
            )
          )
        WHERE chr = NEW.chr AND pos = NEW.pos AND ref = NEW.ref AND alt = NEW.alt;
      END
    `)

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_va_after_delete
      AFTER DELETE ON variant_annotations
      FOR EACH ROW
      BEGIN
        UPDATE cohort_variant_summary SET
          has_star = (
            SELECT CASE WHEN EXISTS(
              SELECT 1 FROM variant_annotations va
              WHERE va.chr = OLD.chr AND va.pos = OLD.pos AND va.ref = OLD.ref AND va.alt = OLD.alt AND va.starred = 1
            ) OR EXISTS(
              SELECT 1 FROM case_variant_annotations cva
              JOIN variants v ON cva.variant_id = v.id
              WHERE v.chr = OLD.chr AND v.pos = OLD.pos AND v.ref = OLD.ref AND v.alt = OLD.alt AND cva.starred = 1
            ) THEN 1 ELSE 0 END
          ),
          has_comment = (
            SELECT CASE WHEN EXISTS(
              SELECT 1 FROM variant_annotations va
              WHERE va.chr = OLD.chr AND va.pos = OLD.pos AND va.ref = OLD.ref AND va.alt = OLD.alt
              AND va.global_comment IS NOT NULL AND va.global_comment != ''
            ) OR EXISTS(
              SELECT 1 FROM case_variant_annotations cva
              JOIN variants v ON cva.variant_id = v.id
              WHERE v.chr = OLD.chr AND v.pos = OLD.pos AND v.ref = OLD.ref AND v.alt = OLD.alt
              AND cva.per_case_comment IS NOT NULL AND cva.per_case_comment != ''
            ) THEN 1 ELSE 0 END
          ),
          acmg_best = (
            SELECT CASE MAX(rank) WHEN 5 THEN 'Pathogenic' WHEN 4 THEN 'Likely pathogenic'
              WHEN 3 THEN 'Uncertain significance' WHEN 2 THEN 'Likely benign'
              WHEN 1 THEN 'Benign' ELSE NULL END
            FROM (
              SELECT CASE va.acmg_classification
                WHEN 'Pathogenic' THEN 5 WHEN 'Likely pathogenic' THEN 4
                WHEN 'Uncertain significance' THEN 3 WHEN 'Likely benign' THEN 2
                WHEN 'Benign' THEN 1 ELSE 0 END AS rank
              FROM variant_annotations va
              WHERE va.chr = OLD.chr AND va.pos = OLD.pos AND va.ref = OLD.ref AND va.alt = OLD.alt
              AND va.acmg_classification IS NOT NULL
              UNION ALL
              SELECT CASE cva.acmg_classification
                WHEN 'Pathogenic' THEN 5 WHEN 'Likely pathogenic' THEN 4
                WHEN 'Uncertain significance' THEN 3 WHEN 'Likely benign' THEN 2
                WHEN 'Benign' THEN 1 ELSE 0 END
              FROM case_variant_annotations cva
              JOIN variants v ON cva.variant_id = v.id
              WHERE v.chr = OLD.chr AND v.pos = OLD.pos AND v.ref = OLD.ref AND v.alt = OLD.alt
              AND cva.acmg_classification IS NOT NULL
            )
          )
        WHERE chr = OLD.chr AND pos = OLD.pos AND ref = OLD.ref AND alt = OLD.alt;
      END
    `)

    // --- case_variant_annotations triggers ---

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_cva_after_insert
      AFTER INSERT ON case_variant_annotations
      FOR EACH ROW
      BEGIN
        UPDATE cohort_variant_summary SET
          has_star = (
            SELECT CASE WHEN EXISTS(
              SELECT 1 FROM variant_annotations va
              WHERE va.chr = cohort_variant_summary.chr AND va.pos = cohort_variant_summary.pos
              AND va.ref = cohort_variant_summary.ref AND va.alt = cohort_variant_summary.alt AND va.starred = 1
            ) OR EXISTS(
              SELECT 1 FROM case_variant_annotations cva
              JOIN variants v ON cva.variant_id = v.id
              WHERE v.chr = cohort_variant_summary.chr AND v.pos = cohort_variant_summary.pos
              AND v.ref = cohort_variant_summary.ref AND v.alt = cohort_variant_summary.alt AND cva.starred = 1
            ) THEN 1 ELSE 0 END
          ),
          has_comment = (
            SELECT CASE WHEN EXISTS(
              SELECT 1 FROM variant_annotations va
              WHERE va.chr = cohort_variant_summary.chr AND va.pos = cohort_variant_summary.pos
              AND va.ref = cohort_variant_summary.ref AND va.alt = cohort_variant_summary.alt
              AND va.global_comment IS NOT NULL AND va.global_comment != ''
            ) OR EXISTS(
              SELECT 1 FROM case_variant_annotations cva
              JOIN variants v ON cva.variant_id = v.id
              WHERE v.chr = cohort_variant_summary.chr AND v.pos = cohort_variant_summary.pos
              AND v.ref = cohort_variant_summary.ref AND v.alt = cohort_variant_summary.alt
              AND cva.per_case_comment IS NOT NULL AND cva.per_case_comment != ''
            ) THEN 1 ELSE 0 END
          ),
          acmg_best = (
            SELECT CASE MAX(rank) WHEN 5 THEN 'Pathogenic' WHEN 4 THEN 'Likely pathogenic'
              WHEN 3 THEN 'Uncertain significance' WHEN 2 THEN 'Likely benign'
              WHEN 1 THEN 'Benign' ELSE NULL END
            FROM (
              SELECT CASE va.acmg_classification
                WHEN 'Pathogenic' THEN 5 WHEN 'Likely pathogenic' THEN 4
                WHEN 'Uncertain significance' THEN 3 WHEN 'Likely benign' THEN 2
                WHEN 'Benign' THEN 1 ELSE 0 END AS rank
              FROM variant_annotations va
              WHERE va.chr = cohort_variant_summary.chr AND va.pos = cohort_variant_summary.pos
              AND va.ref = cohort_variant_summary.ref AND va.alt = cohort_variant_summary.alt
              AND va.acmg_classification IS NOT NULL
              UNION ALL
              SELECT CASE cva.acmg_classification
                WHEN 'Pathogenic' THEN 5 WHEN 'Likely pathogenic' THEN 4
                WHEN 'Uncertain significance' THEN 3 WHEN 'Likely benign' THEN 2
                WHEN 'Benign' THEN 1 ELSE 0 END
              FROM case_variant_annotations cva
              JOIN variants v ON cva.variant_id = v.id
              WHERE v.chr = cohort_variant_summary.chr AND v.pos = cohort_variant_summary.pos
              AND v.ref = cohort_variant_summary.ref AND v.alt = cohort_variant_summary.alt
              AND cva.acmg_classification IS NOT NULL
            )
          )
        WHERE (chr, pos, ref, alt) IN (
          SELECT chr, pos, ref, alt FROM variants WHERE id = NEW.variant_id
        );
      END
    `)

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_cva_after_update
      AFTER UPDATE ON case_variant_annotations
      FOR EACH ROW
      WHEN OLD.starred != NEW.starred
        OR OLD.per_case_comment IS NOT NEW.per_case_comment
        OR OLD.acmg_classification IS NOT NEW.acmg_classification
      BEGIN
        UPDATE cohort_variant_summary SET
          has_star = (
            SELECT CASE WHEN EXISTS(
              SELECT 1 FROM variant_annotations va
              WHERE va.chr = cohort_variant_summary.chr AND va.pos = cohort_variant_summary.pos
              AND va.ref = cohort_variant_summary.ref AND va.alt = cohort_variant_summary.alt AND va.starred = 1
            ) OR EXISTS(
              SELECT 1 FROM case_variant_annotations cva
              JOIN variants v ON cva.variant_id = v.id
              WHERE v.chr = cohort_variant_summary.chr AND v.pos = cohort_variant_summary.pos
              AND v.ref = cohort_variant_summary.ref AND v.alt = cohort_variant_summary.alt AND cva.starred = 1
            ) THEN 1 ELSE 0 END
          ),
          has_comment = (
            SELECT CASE WHEN EXISTS(
              SELECT 1 FROM variant_annotations va
              WHERE va.chr = cohort_variant_summary.chr AND va.pos = cohort_variant_summary.pos
              AND va.ref = cohort_variant_summary.ref AND va.alt = cohort_variant_summary.alt
              AND va.global_comment IS NOT NULL AND va.global_comment != ''
            ) OR EXISTS(
              SELECT 1 FROM case_variant_annotations cva
              JOIN variants v ON cva.variant_id = v.id
              WHERE v.chr = cohort_variant_summary.chr AND v.pos = cohort_variant_summary.pos
              AND v.ref = cohort_variant_summary.ref AND v.alt = cohort_variant_summary.alt
              AND cva.per_case_comment IS NOT NULL AND cva.per_case_comment != ''
            ) THEN 1 ELSE 0 END
          ),
          acmg_best = (
            SELECT CASE MAX(rank) WHEN 5 THEN 'Pathogenic' WHEN 4 THEN 'Likely pathogenic'
              WHEN 3 THEN 'Uncertain significance' WHEN 2 THEN 'Likely benign'
              WHEN 1 THEN 'Benign' ELSE NULL END
            FROM (
              SELECT CASE va.acmg_classification
                WHEN 'Pathogenic' THEN 5 WHEN 'Likely pathogenic' THEN 4
                WHEN 'Uncertain significance' THEN 3 WHEN 'Likely benign' THEN 2
                WHEN 'Benign' THEN 1 ELSE 0 END AS rank
              FROM variant_annotations va
              WHERE va.chr = cohort_variant_summary.chr AND va.pos = cohort_variant_summary.pos
              AND va.ref = cohort_variant_summary.ref AND va.alt = cohort_variant_summary.alt
              AND va.acmg_classification IS NOT NULL
              UNION ALL
              SELECT CASE cva.acmg_classification
                WHEN 'Pathogenic' THEN 5 WHEN 'Likely pathogenic' THEN 4
                WHEN 'Uncertain significance' THEN 3 WHEN 'Likely benign' THEN 2
                WHEN 'Benign' THEN 1 ELSE 0 END
              FROM case_variant_annotations cva
              JOIN variants v ON cva.variant_id = v.id
              WHERE v.chr = cohort_variant_summary.chr AND v.pos = cohort_variant_summary.pos
              AND v.ref = cohort_variant_summary.ref AND v.alt = cohort_variant_summary.alt
              AND cva.acmg_classification IS NOT NULL
            )
          )
        WHERE (chr, pos, ref, alt) IN (
          SELECT chr, pos, ref, alt FROM variants WHERE id = NEW.variant_id
        );
      END
    `)

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_cva_after_delete
      AFTER DELETE ON case_variant_annotations
      FOR EACH ROW
      BEGIN
        UPDATE cohort_variant_summary SET
          has_star = (
            SELECT CASE WHEN EXISTS(
              SELECT 1 FROM variant_annotations va
              WHERE va.chr = cohort_variant_summary.chr AND va.pos = cohort_variant_summary.pos
              AND va.ref = cohort_variant_summary.ref AND va.alt = cohort_variant_summary.alt AND va.starred = 1
            ) OR EXISTS(
              SELECT 1 FROM case_variant_annotations cva
              JOIN variants v ON cva.variant_id = v.id
              WHERE v.chr = cohort_variant_summary.chr AND v.pos = cohort_variant_summary.pos
              AND v.ref = cohort_variant_summary.ref AND v.alt = cohort_variant_summary.alt AND cva.starred = 1
            ) THEN 1 ELSE 0 END
          ),
          has_comment = (
            SELECT CASE WHEN EXISTS(
              SELECT 1 FROM variant_annotations va
              WHERE va.chr = cohort_variant_summary.chr AND va.pos = cohort_variant_summary.pos
              AND va.ref = cohort_variant_summary.ref AND va.alt = cohort_variant_summary.alt
              AND va.global_comment IS NOT NULL AND va.global_comment != ''
            ) OR EXISTS(
              SELECT 1 FROM case_variant_annotations cva
              JOIN variants v ON cva.variant_id = v.id
              WHERE v.chr = cohort_variant_summary.chr AND v.pos = cohort_variant_summary.pos
              AND v.ref = cohort_variant_summary.ref AND v.alt = cohort_variant_summary.alt
              AND cva.per_case_comment IS NOT NULL AND cva.per_case_comment != ''
            ) THEN 1 ELSE 0 END
          ),
          acmg_best = (
            SELECT CASE MAX(rank) WHEN 5 THEN 'Pathogenic' WHEN 4 THEN 'Likely pathogenic'
              WHEN 3 THEN 'Uncertain significance' WHEN 2 THEN 'Likely benign'
              WHEN 1 THEN 'Benign' ELSE NULL END
            FROM (
              SELECT CASE va.acmg_classification
                WHEN 'Pathogenic' THEN 5 WHEN 'Likely pathogenic' THEN 4
                WHEN 'Uncertain significance' THEN 3 WHEN 'Likely benign' THEN 2
                WHEN 'Benign' THEN 1 ELSE 0 END AS rank
              FROM variant_annotations va
              WHERE va.chr = cohort_variant_summary.chr AND va.pos = cohort_variant_summary.pos
              AND va.ref = cohort_variant_summary.ref AND va.alt = cohort_variant_summary.alt
              AND va.acmg_classification IS NOT NULL
              UNION ALL
              SELECT CASE cva.acmg_classification
                WHEN 'Pathogenic' THEN 5 WHEN 'Likely pathogenic' THEN 4
                WHEN 'Uncertain significance' THEN 3 WHEN 'Likely benign' THEN 2
                WHEN 'Benign' THEN 1 ELSE 0 END
              FROM case_variant_annotations cva
              JOIN variants v ON cva.variant_id = v.id
              WHERE v.chr = cohort_variant_summary.chr AND v.pos = cohort_variant_summary.pos
              AND v.ref = cohort_variant_summary.ref AND v.alt = cohort_variant_summary.alt
              AND cva.acmg_classification IS NOT NULL
            )
          )
        WHERE (chr, pos, ref, alt) IN (
          SELECT chr, pos, ref, alt FROM variants WHERE id = OLD.variant_id
        );
      END
    `)

    // Covering indexes for common filter+sort patterns
    // Drop v13 indexes that are now prefixes of covering indexes
    db.exec(`
      DROP INDEX IF EXISTS idx_cvs_consequence;
      DROP INDEX IF EXISTS idx_cvs_gene;

      CREATE INDEX IF NOT EXISTS idx_cvs_covering_common
        ON cohort_variant_summary(consequence, gnomad_af, carrier_count);

      CREATE INDEX IF NOT EXISTS idx_cvs_gene_covering
        ON cohort_variant_summary(gene_symbol, carrier_count);
    `)

    db.exec('PRAGMA user_version = 14')
  }

  // ── Migration v15: Filter presets table ──────────────────
  if (currentVersion < 15) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS filter_presets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        filter_json TEXT NOT NULL DEFAULT '{}',
        is_built_in INTEGER NOT NULL DEFAULT 0,
        is_visible INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_filter_presets_name
        ON filter_presets(name);
    `)

    // Seed built-in presets
    const now = Date.now()
    const insertStmt = db.prepare(
      `INSERT OR IGNORE INTO filter_presets
        (name, description, filter_json, is_built_in, is_visible, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, 1, 1, ?, ?, ?)`
    )
    for (const preset of BUILT_IN_PRESETS) {
      insertStmt.run(
        preset.name,
        preset.description,
        JSON.stringify(preset.filterJson),
        preset.sortOrder,
        now,
        now
      )
    }

    db.exec('PRAGMA user_version = 15')
  }

  // ── Migration v16: Rework built-in presets to clinical combos ──
  if (currentVersion < 16) {
    // Preserve user visibility preferences for built-in presets before reseeding
    const existingVisibility = new Map<string, number>()
    const existingRows = db
      .prepare('SELECT name, is_visible FROM filter_presets WHERE is_built_in = 1')
      .all() as { name: string; is_visible: number }[]
    for (const row of existingRows) {
      existingVisibility.set(row.name, row.is_visible)
    }
    // Delete old built-in presets and re-seed with clinically meaningful combos
    db.exec('DELETE FROM filter_presets WHERE is_built_in = 1')

    const now = Date.now()
    const insertStmt = db.prepare(
      `INSERT OR IGNORE INTO filter_presets
        (name, description, filter_json, is_built_in, is_visible, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, 1, 1, ?, ?, ?)`
    )
    for (const preset of BUILT_IN_PRESETS) {
      insertStmt.run(
        preset.name,
        preset.description,
        JSON.stringify(preset.filterJson),
        preset.sortOrder,
        now,
        now
      )
    }

    // Restore user visibility preferences for presets that existed before
    const restoreStmt = db.prepare(
      'UPDATE filter_presets SET is_visible = ? WHERE name = ? AND is_built_in = 1'
    )
    for (const [name, isVisible] of existingVisibility) {
      restoreStmt.run(isVisible, name)
    }

    db.exec('PRAGMA user_version = 16')
  }

  // ── v17: Performance indexes for annotation filter queries ──────────
  if (currentVersion < 17) {
    db.exec(`
      -- Composite index for tag filtering: (case_id, tag_id) for WHERE clause,
      -- variant_id last makes the index covering for SELECT variant_id
      CREATE INDEX IF NOT EXISTS idx_variant_tags_case_tag
        ON variant_tags(case_id, tag_id, variant_id);

      -- Partial index for starred filter (only rows where starred=1)
      CREATE INDEX IF NOT EXISTS idx_cva_case_starred
        ON case_variant_annotations(case_id, variant_id)
        WHERE starred = 1;

      -- Index for ACMG classification filter queries
      CREATE INDEX IF NOT EXISTS idx_cva_case_acmg
        ON case_variant_annotations(case_id, acmg_classification);

      -- Composite index for global annotation coordinate lookups
      -- (covers EXISTS subqueries in star/comment/ACMG scope='all' filters)
      CREATE INDEX IF NOT EXISTS idx_va_coords_starred
        ON variant_annotations(chr, pos, ref, alt, starred);

      PRAGMA user_version = 17;
    `)
  }

  // ── v18: Add composite index on variant_annotations for coordinate lookups ──
  if (currentVersion < 18) {
    db.exec(`
      -- Explicit composite index for coordinate-based annotation lookups.
      -- The UNIQUE constraint on (chr, pos, ref, alt) creates an implicit index,
      -- but this explicit index includes acmg_classification for covering queries
      -- in the starred/comment/ACMG scope='all' UNION filters.
      CREATE INDEX IF NOT EXISTS idx_variant_annotations_coords_acmg
        ON variant_annotations(chr, pos, ref, alt, acmg_classification);

      PRAGMA user_version = 18;
    `)
  }

  // ── v19: panels, panel_genes, case_active_panels + cases.genome_build ──
  if (currentVersion < 19) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS panels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        version TEXT,
        source TEXT NOT NULL DEFAULT 'manual',
        source_id TEXT,
        source_metadata TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS panel_genes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        panel_id INTEGER NOT NULL REFERENCES panels(id) ON DELETE CASCADE,
        hgnc_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        UNIQUE(panel_id, hgnc_id)
      );

      CREATE TABLE IF NOT EXISTS case_active_panels (
        case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        panel_id INTEGER NOT NULL REFERENCES panels(id) ON DELETE CASCADE,
        padding_bp INTEGER NOT NULL DEFAULT 5000,
        activated_at INTEGER NOT NULL,
        PRIMARY KEY (case_id, panel_id)
      );

      CREATE INDEX IF NOT EXISTS idx_panel_genes_panel ON panel_genes(panel_id);
      CREATE INDEX IF NOT EXISTS idx_case_active_panels_case ON case_active_panels(case_id);
    `)

    // Add genome_build column to cases
    const caseCols = db.prepare("PRAGMA table_info('cases')").all() as Array<{ name: string }>
    if (!caseCols.some((c) => c.name === 'genome_build')) {
      db.exec("ALTER TABLE cases ADD COLUMN genome_build TEXT DEFAULT 'GRCh38'")
      db.exec("UPDATE cases SET genome_build = 'GRCh38' WHERE genome_build IS NULL")
    }

    db.exec('PRAGMA user_version = 19')
  }

  // v20: variant_frequency table for internal AF tracking (#106)
  if (currentVersion < 20) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS variant_frequency (
        chr TEXT NOT NULL,
        pos INTEGER NOT NULL,
        ref TEXT NOT NULL,
        alt TEXT NOT NULL,
        case_count INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (chr, pos, ref, alt)
      );
    `)

    // Backfill from existing variants
    db.exec(`
      INSERT OR IGNORE INTO variant_frequency (chr, pos, ref, alt, case_count)
      SELECT chr, pos, ref, alt, COUNT(DISTINCT case_id) as case_count
      FROM variants
      GROUP BY chr, pos, ref, alt;
    `)

    db.exec('PRAGMA user_version = 20')
  }

  // v21: analysis_groups + analysis_group_members for family/trio support (#107)
  if (currentVersion < 21) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS analysis_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        group_type TEXT NOT NULL DEFAULT 'family'
          CHECK(group_type IN ('family', 'tumor_normal')),
        description TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );

      CREATE TABLE IF NOT EXISTS analysis_group_members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL REFERENCES analysis_groups(id) ON DELETE CASCADE,
        case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN (
          'proband', 'father', 'mother', 'sibling', 'partner', 'other',
          'tumor', 'normal'
        )),
        affected_status TEXT NOT NULL DEFAULT 'unknown'
          CHECK(affected_status IN ('affected', 'unaffected', 'unknown')),
        individual_id TEXT,
        UNIQUE(group_id, case_id)
      );

      CREATE INDEX IF NOT EXISTS idx_agm_group ON analysis_group_members(group_id);
      CREATE INDEX IF NOT EXISTS idx_agm_case ON analysis_group_members(case_id);
    `)

    db.exec('PRAGMA user_version = 21')
  }

  // v22: Cross-case variant coordinate index for trio inheritance queries (#107)
  if (currentVersion < 22) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_variants_coord_case
        ON variants(chr, pos, ref, alt, case_id);
    `)
    db.exec('PRAGMA user_version = 22')
  }

  // v23: VCF import columns on variants + cases (#42)
  if (currentVersion < 23) {
    // Add VCF-specific columns to variants table (idempotent)
    const varCols = db.prepare('PRAGMA table_info(variants)').all() as { name: string }[]
    const varColNames = new Set(varCols.map((c) => c.name))
    if (!varColNames.has('gq')) db.exec('ALTER TABLE variants ADD COLUMN gq REAL')
    if (!varColNames.has('dp')) db.exec('ALTER TABLE variants ADD COLUMN dp INTEGER')
    if (!varColNames.has('ad_ref')) db.exec('ALTER TABLE variants ADD COLUMN ad_ref INTEGER')
    if (!varColNames.has('ad_alt')) db.exec('ALTER TABLE variants ADD COLUMN ad_alt INTEGER')
    if (!varColNames.has('ab')) db.exec('ALTER TABLE variants ADD COLUMN ab REAL')
    if (!varColNames.has('filter')) db.exec('ALTER TABLE variants ADD COLUMN filter TEXT')
    if (!varColNames.has('info_json')) db.exec('ALTER TABLE variants ADD COLUMN info_json TEXT')
    if (!varColNames.has('source_format'))
      db.exec('ALTER TABLE variants ADD COLUMN source_format TEXT')

    // Add VCF-specific columns to cases table (idempotent)
    const caseCols = db.prepare('PRAGMA table_info(cases)').all() as { name: string }[]
    const caseColNames = new Set(caseCols.map((c) => c.name))
    if (!caseColNames.has('source_format'))
      db.exec('ALTER TABLE cases ADD COLUMN source_format TEXT')
    if (!caseColNames.has('sample_name')) db.exec('ALTER TABLE cases ADD COLUMN sample_name TEXT')

    // Partial index for variants with unmapped INFO fields
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_variants_info_json
        ON variants(case_id) WHERE info_json IS NOT NULL;
    `)

    db.exec('PRAGMA user_version = 23')
  }

  // v24: Normalize ACMG classification labels to ClinVar sentence case
  if (currentVersion < 24) {
    // Step 1: Normalize variant_annotations
    db.exec(`
      UPDATE variant_annotations SET acmg_classification = 'Pathogenic'
        WHERE acmg_classification = 'P';
      UPDATE variant_annotations SET acmg_classification = 'Likely pathogenic'
        WHERE acmg_classification IN ('Likely Pathogenic', 'LP');
      UPDATE variant_annotations SET acmg_classification = 'Uncertain significance'
        WHERE acmg_classification IN ('VUS', 'Uncertain Significance');
      UPDATE variant_annotations SET acmg_classification = 'Likely benign'
        WHERE acmg_classification IN ('Likely Benign', 'LB');
      UPDATE variant_annotations SET acmg_classification = 'Benign'
        WHERE acmg_classification = 'B';
    `)

    // Step 2: Normalize case_variant_annotations
    db.exec(`
      UPDATE case_variant_annotations SET acmg_classification = 'Pathogenic'
        WHERE acmg_classification = 'P';
      UPDATE case_variant_annotations SET acmg_classification = 'Likely pathogenic'
        WHERE acmg_classification IN ('Likely Pathogenic', 'LP');
      UPDATE case_variant_annotations SET acmg_classification = 'Uncertain significance'
        WHERE acmg_classification IN ('VUS', 'Uncertain Significance');
      UPDATE case_variant_annotations SET acmg_classification = 'Likely benign'
        WHERE acmg_classification IN ('Likely Benign', 'LB');
      UPDATE case_variant_annotations SET acmg_classification = 'Benign'
        WHERE acmg_classification = 'B';
    `)

    // Step 3: Recompute acmg_best in cohort_variant_summary
    const hasSummary = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='cohort_variant_summary'"
      )
      .get()
    if (hasSummary != null) {
      db.exec(`
        UPDATE cohort_variant_summary SET acmg_best = (
          SELECT CASE MAX(rank)
            WHEN 5 THEN 'Pathogenic' WHEN 4 THEN 'Likely pathogenic'
            WHEN 3 THEN 'Uncertain significance' WHEN 2 THEN 'Likely benign'
            WHEN 1 THEN 'Benign' ELSE NULL END
          FROM (
            SELECT CASE va.acmg_classification
              WHEN 'Pathogenic' THEN 5 WHEN 'Likely pathogenic' THEN 4
              WHEN 'Uncertain significance' THEN 3 WHEN 'Likely benign' THEN 2
              WHEN 'Benign' THEN 1 ELSE 0 END AS rank
            FROM variant_annotations va
            WHERE va.chr = cohort_variant_summary.chr
              AND va.pos = cohort_variant_summary.pos
              AND va.ref = cohort_variant_summary.ref
              AND va.alt = cohort_variant_summary.alt
              AND va.acmg_classification IS NOT NULL
            UNION ALL
            SELECT CASE cva.acmg_classification
              WHEN 'Pathogenic' THEN 5 WHEN 'Likely pathogenic' THEN 4
              WHEN 'Uncertain significance' THEN 3 WHEN 'Likely benign' THEN 2
              WHEN 'Benign' THEN 1 ELSE 0 END AS rank
            FROM case_variant_annotations cva
            JOIN variants v ON v.id = cva.variant_id
            WHERE v.chr = cohort_variant_summary.chr
              AND v.pos = cohort_variant_summary.pos
              AND v.ref = cohort_variant_summary.ref
              AND v.alt = cohort_variant_summary.alt
              AND cva.acmg_classification IS NOT NULL
          )
        )
      `)
    }

    db.exec('PRAGMA user_version = 24')
  }

  // ── v25: Multi-variant type support (SV/CNV/STR extension tables) ──
  if (currentVersion < 25) {
    // 1. New columns on variants table
    const varCols = db.pragma('table_info(variants)') as Array<{ name: string }>
    if (!varCols.some((c) => c.name === 'variant_type')) {
      db.exec("ALTER TABLE variants ADD COLUMN variant_type TEXT NOT NULL DEFAULT 'snv'")
      db.exec('ALTER TABLE variants ADD COLUMN end_pos INTEGER')
      db.exec('ALTER TABLE variants ADD COLUMN sv_type TEXT')
      db.exec('ALTER TABLE variants ADD COLUMN sv_length INTEGER')
      db.exec('ALTER TABLE variants ADD COLUMN caller TEXT')
    }

    // 2. Classify existing variants by REF/ALT length
    db.exec(`
      UPDATE variants SET variant_type =
        CASE
          WHEN length(ref) = 1 AND length(alt) = 1 THEN 'snv'
          ELSE 'indel'
        END
    `)

    // 3. Indexes on new columns
    db.exec('CREATE INDEX IF NOT EXISTS idx_variants_type ON variants(variant_type)')
    db.exec('CREATE INDEX IF NOT EXISTS idx_variants_type_case ON variants(variant_type, case_id)')
    db.exec(
      'CREATE INDEX IF NOT EXISTS idx_variants_end_pos ON variants(chr, end_pos) WHERE end_pos IS NOT NULL'
    )

    // 4. SV extension table
    db.exec(`
      CREATE TABLE IF NOT EXISTS variant_sv (
        variant_id INTEGER PRIMARY KEY,
        sv_is_precise INTEGER,
        cipos_left INTEGER, cipos_right INTEGER,
        ciend_left INTEGER, ciend_right INTEGER,
        support INTEGER, coverage TEXT, strand TEXT,
        stdev_len REAL, stdev_pos REAL, vaf REAL,
        dr INTEGER, dv INTEGER,
        pe_support INTEGER, sr_support INTEGER,
        event_id TEXT, mate_id TEXT,
        FOREIGN KEY (variant_id) REFERENCES variants(id) ON DELETE CASCADE
      )
    `)

    // 5. CNV extension table
    db.exec(`
      CREATE TABLE IF NOT EXISTS variant_cnv (
        variant_id INTEGER PRIMARY KEY,
        copy_number INTEGER, copy_number_quality INTEGER,
        homozygosity_ref REAL, homozygosity_alt REAL,
        sm REAL, bin_count INTEGER,
        FOREIGN KEY (variant_id) REFERENCES variants(id) ON DELETE CASCADE
      )
    `)
    db.exec('CREATE INDEX IF NOT EXISTS idx_cnv_copy_number ON variant_cnv(copy_number)')

    // 6. STR extension table
    db.exec(`
      CREATE TABLE IF NOT EXISTS variant_str (
        variant_id INTEGER PRIMARY KEY,
        repeat_id TEXT, variant_catalog_id TEXT,
        repeat_unit TEXT, display_repeat_unit TEXT,
        ref_copies REAL, alt_copies TEXT,
        repeat_length INTEGER,
        str_status TEXT, normal_max INTEGER, pathologic_min INTEGER,
        disease TEXT, inheritance_mode TEXT,
        source_display TEXT, rank_score TEXT,
        locus_coverage REAL, support_type TEXT, confidence_interval TEXT,
        FOREIGN KEY (variant_id) REFERENCES variants(id) ON DELETE CASCADE
      )
    `)
    db.exec('CREATE INDEX IF NOT EXISTS idx_str_repeat_id ON variant_str(repeat_id)')
    db.exec('CREATE INDEX IF NOT EXISTS idx_str_disease ON variant_str(disease)')

    // 7. Case import files provenance table
    db.exec(`
      CREATE TABLE IF NOT EXISTS case_import_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER NOT NULL,
        file_path TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        variant_type TEXT NOT NULL,
        caller TEXT,
        variant_count INTEGER NOT NULL DEFAULT 0,
        annotation_format TEXT,
        imported_at INTEGER NOT NULL,
        FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
      )
    `)
    db.exec('CREATE INDEX IF NOT EXISTS idx_case_import_files_case ON case_import_files(case_id)')

    // 8. Add variant_type + genome_build to cohort summary tables (if they exist)
    const cvsExists = (
      db
        .prepare(
          "SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name='cohort_variant_summary'"
        )
        .get() as { c: number }
    ).c
    if (cvsExists > 0) {
      const cvsCols = db.pragma('table_info(cohort_variant_summary)') as Array<{ name: string }>
      if (!cvsCols.some((c) => c.name === 'variant_type')) {
        db.exec(
          "ALTER TABLE cohort_variant_summary ADD COLUMN variant_type TEXT NOT NULL DEFAULT 'snv'"
        )
        db.exec(
          "ALTER TABLE cohort_variant_summary ADD COLUMN genome_build TEXT NOT NULL DEFAULT 'GRCh38'"
        )
      }
    }

    const gbsExists = (
      db
        .prepare(
          "SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name='gene_burden_summary'"
        )
        .get() as { c: number }
    ).c
    if (gbsExists > 0) {
      const gbsCols = db.pragma('table_info(gene_burden_summary)') as Array<{ name: string }>
      if (!gbsCols.some((c) => c.name === 'genome_build')) {
        db.exec(
          "ALTER TABLE gene_burden_summary ADD COLUMN genome_build TEXT NOT NULL DEFAULT 'GRCh38'"
        )
      }
    }

    // 9. Mark cohort summary as stale for full rebuild (derives variant_type from variants)
    const metaExists = (
      db
        .prepare(
          "SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name='cohort_summary_meta'"
        )
        .get() as { c: number }
    ).c
    if (metaExists > 0) {
      db.exec("INSERT OR REPLACE INTO cohort_summary_meta (key, value) VALUES ('is_stale', '1')")
    }

    db.exec('PRAGMA user_version = 25')
  }
}
