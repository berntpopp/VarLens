/**
 * Database migrations for Varlens
 *
 * Uses PRAGMA user_version to track schema version and apply migrations atomically.
 * Migrations are idempotent and safe for both plaintext and encrypted databases.
 */

import type Database from 'better-sqlite3-multiple-ciphers'

/**
 * Run schema migrations based on PRAGMA user_version
 *
 * IMPORTANT: This function must be called AFTER PRAGMA key is issued for encrypted databases.
 * The encryption key must be set before any database operations, including version checks.
 *
 * Version history:
 * - 0 (implicit): Initial v0.3.0 schema (cases, variants, FTS)
 * - 1: Mark existing v0.3.0 databases
 * - 2: v0.4.0 annotation tables
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
}
