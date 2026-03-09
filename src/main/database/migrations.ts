/**
 * Database migrations for Varlens
 *
 * Uses PRAGMA user_version to track schema version and apply migrations atomically.
 * Migrations are idempotent and safe for both plaintext and encrypted databases.
 */

import type Database from 'better-sqlite3-multiple-ciphers'
import { CLINICAL_METRICS } from './clinical-metrics'

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
}
