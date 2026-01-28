/**
 * Database schema definitions for Varlens
 *
 * SQL schema for cases and variants tables with FTS5 full-text search.
 */

import type Database from 'better-sqlite3-multiple-ciphers'

/**
 * SQL to create the cases and variants tables
 */
export const createTables = `
CREATE TABLE IF NOT EXISTS cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  file_path TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  variant_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  chr TEXT NOT NULL,
  pos INTEGER NOT NULL,
  ref TEXT NOT NULL,
  alt TEXT NOT NULL,
  gene_symbol TEXT,
  omim_mim_number TEXT,
  consequence TEXT,
  gnomad_af REAL,
  cadd REAL,
  clinvar TEXT,
  gt_num TEXT,
  func TEXT,
  qual REAL,
  hpo_sim_score REAL,
  transcript TEXT,
  cdna TEXT,
  aa_change TEXT,
  hpo_match TEXT,
  moi TEXT,
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
);
`

/**
 * SQL to create indexes on the variants table
 */
export const createIndexes = `
CREATE INDEX IF NOT EXISTS idx_variants_case_id ON variants(case_id);
CREATE INDEX IF NOT EXISTS idx_variants_gene ON variants(gene_symbol);
CREATE INDEX IF NOT EXISTS idx_variants_pos ON variants(chr, pos);
CREATE INDEX IF NOT EXISTS idx_variants_filters ON variants(gnomad_af, cadd);
CREATE INDEX IF NOT EXISTS idx_variants_chr_pos_ref_alt ON variants(chr, pos, ref, alt);
`

/**
 * SQL to create the FTS5 virtual table for full-text search
 *
 * Configuration:
 * - content='variants': External content table (content stored in variants table)
 * - content_rowid='id': Use variants.id as the rowid
 * - tokenize='unicode61 remove_diacritics 1': Unicode-aware case-insensitive tokenization
 * - prefix='2 3': Create prefix indexes for 2 and 3 character prefixes
 */
export const createFTSTable = `
CREATE VIRTUAL TABLE IF NOT EXISTS variants_fts USING fts5(
  gene_symbol,
  consequence,
  omim_mim_number,
  content='variants',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 1',
  prefix='2 3'
);
`

/**
 * SQL to create triggers that keep FTS index in sync with variants table
 *
 * Note: For external content FTS5 tables, we use the special
 * INSERT INTO ... VALUES('delete', ...) syntax for deletions.
 */
export const createFTSTriggers = `
CREATE TRIGGER IF NOT EXISTS variants_fts_ai AFTER INSERT ON variants BEGIN
  INSERT INTO variants_fts(rowid, gene_symbol, consequence, omim_mim_number)
  VALUES (new.id, new.gene_symbol, new.consequence, new.omim_mim_number);
END;

CREATE TRIGGER IF NOT EXISTS variants_fts_ad AFTER DELETE ON variants BEGIN
  INSERT INTO variants_fts(variants_fts, rowid, gene_symbol, consequence, omim_mim_number)
  VALUES ('delete', old.id, old.gene_symbol, old.consequence, old.omim_mim_number);
END;

CREATE TRIGGER IF NOT EXISTS variants_fts_au AFTER UPDATE ON variants BEGIN
  INSERT INTO variants_fts(variants_fts, rowid, gene_symbol, consequence, omim_mim_number)
  VALUES ('delete', old.id, old.gene_symbol, old.consequence, old.omim_mim_number);
  INSERT INTO variants_fts(rowid, gene_symbol, consequence, omim_mim_number)
  VALUES (new.id, new.gene_symbol, new.consequence, new.omim_mim_number);
END;
`

/**
 * Legacy FTS5 table definition (without omim_mim_number)
 * Used for databases that don't have the omim_mim_number column
 */
const createFTSTableLegacy = `
CREATE VIRTUAL TABLE IF NOT EXISTS variants_fts USING fts5(
  gene_symbol,
  consequence,
  content='variants',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 1',
  prefix='2 3'
);
`

/**
 * Legacy FTS5 triggers (without omim_mim_number)
 * Used for databases that don't have the omim_mim_number column
 */
const createFTSTriggersLegacy = `
CREATE TRIGGER IF NOT EXISTS variants_fts_ai AFTER INSERT ON variants BEGIN
  INSERT INTO variants_fts(rowid, gene_symbol, consequence)
  VALUES (new.id, new.gene_symbol, new.consequence);
END;

CREATE TRIGGER IF NOT EXISTS variants_fts_ad AFTER DELETE ON variants BEGIN
  INSERT INTO variants_fts(variants_fts, rowid, gene_symbol, consequence)
  VALUES ('delete', old.id, old.gene_symbol, old.consequence);
END;

CREATE TRIGGER IF NOT EXISTS variants_fts_au AFTER UPDATE ON variants BEGIN
  INSERT INTO variants_fts(variants_fts, rowid, gene_symbol, consequence)
  VALUES ('delete', old.id, old.gene_symbol, old.consequence);
  INSERT INTO variants_fts(rowid, gene_symbol, consequence)
  VALUES (new.id, new.gene_symbol, new.consequence);
END;
`

/**
 * Migration: Add new columns to variants table if they don't exist
 * This handles upgrading existing databases to the new schema
 */
const migrateVariantsTable = (db: Database.Database): void => {
  // Get existing columns
  const columns = db.prepare('PRAGMA table_info(variants)').all() as { name: string }[]
  const existingColumns = new Set(columns.map((c) => c.name))

  // New columns to add (column_name, type, default)
  const newColumns: [string, string][] = [
    ['gt_num', 'TEXT'],
    ['func', 'TEXT'],
    ['qual', 'REAL'],
    ['hpo_sim_score', 'REAL'],
    ['transcript', 'TEXT'],
    ['cdna', 'TEXT'],
    ['aa_change', 'TEXT'],
    ['hpo_match', 'TEXT'],
    ['moi', 'TEXT'],
    ['omim_mim_number', 'TEXT']
  ]

  for (const [colName, colType] of newColumns) {
    if (existingColumns.has(colName) === false) {
      db.exec(`ALTER TABLE variants ADD COLUMN ${colName} ${colType}`)
    }
  }
}

/**
 * Initialize the database schema
 *
 * Executes all schema creation SQL in order:
 * 1. Create tables (cases, variants)
 * 2. Run migrations for existing tables
 * 3. Create indexes on variants
 * 4. Create FTS5 virtual table (with rebuild for schema updates)
 * 5. Create FTS sync triggers
 *
 * @param db - better-sqlite3-multiple-ciphers Database instance
 * @throws Error if schema creation fails
 */
export function initializeSchema(db: Database.Database): void {
  db.exec(createTables)
  migrateVariantsTable(db)
  db.exec(createIndexes)

  // Rebuild FTS5 to include any new columns (e.g., omim_mim_number)
  // DROP first since IF NOT EXISTS won't update existing table structure
  db.exec('DROP TABLE IF EXISTS variants_fts')
  // Also drop triggers that reference the old FTS table
  db.exec('DROP TRIGGER IF EXISTS variants_fts_ai')
  db.exec('DROP TRIGGER IF EXISTS variants_fts_ad')
  db.exec('DROP TRIGGER IF EXISTS variants_fts_au')

  // Check if variants table has omim_mim_number column
  const columns = db.prepare('PRAGMA table_info(variants)').all() as { name: string }[]
  const hasOmim = columns.some((c) => c.name === 'omim_mim_number')

  if (hasOmim) {
    // Create FTS5 with omim_mim_number
    db.exec(createFTSTable)
    // Repopulate FTS5 index from existing data
    db.exec(`
      INSERT INTO variants_fts(rowid, gene_symbol, consequence, omim_mim_number)
      SELECT id, gene_symbol, consequence, omim_mim_number FROM variants
    `)
    // Create triggers for future changes
    db.exec(createFTSTriggers)
  } else {
    // Legacy database without omim column -- use old FTS structure
    db.exec(createFTSTableLegacy)
    db.exec(`
      INSERT INTO variants_fts(rowid, gene_symbol, consequence)
      SELECT id, gene_symbol, consequence FROM variants
    `)
    db.exec(createFTSTriggersLegacy)
  }
}
