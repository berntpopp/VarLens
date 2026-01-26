/**
 * Database schema definitions for Varlens
 *
 * SQL schema for cases and variants tables with FTS5 full-text search.
 */

import type Database from 'better-sqlite3'

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
  consequence TEXT,
  gnomad_af REAL,
  cadd REAL,
  clinvar TEXT,
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
 * Initialize the database schema
 *
 * Executes all schema creation SQL in order:
 * 1. Create tables (cases, variants)
 * 2. Create indexes on variants
 * 3. Create FTS5 virtual table
 * 4. Create FTS sync triggers
 *
 * @param db - better-sqlite3 Database instance
 * @throws Error if schema creation fails
 */
export function initializeSchema(db: Database.Database): void {
  db.exec(createTables)
  db.exec(createIndexes)
  db.exec(createFTSTable)
  db.exec(createFTSTriggers)
}
