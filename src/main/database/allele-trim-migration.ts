/**
 * SQLite schema v57 (#587; PG twin: storage/postgres/migrations/allele-trim-backfill.ts):
 * rows imported before allele trimming get the minimal alleles an import
 * stores now, so old and new cases share one key. The decisions are in
 * shared/genome/allele-trim-plan.ts. Runs in one transaction; a second run
 * finds nothing to trim.
 */
import type Database from 'better-sqlite3-multiple-ciphers'

import {
  ALLELE_TRIM_MIGRATION_USER,
  planAnnotationTrim,
  trimCandidateSql,
  TRIM_PAGE_SIZE,
  trimVariantRow,
  type AnnotationTrimPlan,
  type AnnotationTrimRow,
  type VariantAlleles
} from '../../shared/genome/allele-trim-plan'
import { MARK_STALE_SQL } from '../../shared/sql/cohort-summary-rebuild'
import { hasTable } from './contig-rename-sqlite'

type Db = Database.Database

/** Trim the padded small-variant rows, a page at a time; returns how many changed. */
function trimVariants(db: Db): number {
  const page = db.prepare(
    `SELECT id, pos, ref, alt, variant_type FROM variants
      WHERE id > ? AND variant_type IN ('snv', 'indel') AND ${trimCandidateSql()}
      ORDER BY id LIMIT ${TRIM_PAGE_SIZE}`
  )
  const update = db.prepare(
    'UPDATE variants SET pos = ?, ref = ?, alt = ?, variant_type = ? WHERE id = ?'
  )
  let changed = 0
  for (let last = 0; ;) {
    const rows = page.all(last) as VariantAlleles[]
    if (rows.length === 0) return changed
    for (const row of rows) {
      const t = trimVariantRow(row)
      if (t === null) continue
      update.run(t.pos, t.ref, t.alt, t.variant_type, t.id)
      changed++
    }
    last = rows[rows.length - 1].id
  }
}

/** Every annotation (the trimmed keys may already hold one); locus_level only matters for candidates. */
function annotationRows(db: Db): AnnotationTrimRow[] {
  const rows = db
    .prepare(
      `SELECT va.*, CASE WHEN ${trimCandidateSql('va.')} THEN EXISTS (
         SELECT 1 FROM variants v
          WHERE v.chr = va.chr AND v.pos = va.pos AND v.ref = va.ref AND v.alt = va.alt
            AND v.variant_type NOT IN ('snv', 'indel')
       ) ELSE 0 END AS locus_level
       FROM variant_annotations va`
    )
    .all() as Array<Omit<AnnotationTrimRow, 'locus_level'> & { locus_level: number }>
  return rows.map((r) => ({ ...r, locus_level: r.locus_level === 1 }))
}

function applyAnnotationPlan(db: Db, plan: AnnotationTrimPlan, now: number): void {
  const move = db.prepare('UPDATE variant_annotations SET pos = ?, ref = ?, alt = ? WHERE id = ?')
  for (const m of plan.moves) move.run(m.pos, m.ref, m.alt, m.id)
  const del = db.prepare('DELETE FROM variant_annotations WHERE id = ?')
  for (const id of plan.deleteIds) del.run(id)
  const insert = db.prepare(
    `INSERT INTO variant_annotations (chr, pos, ref, alt, genome_build, global_comment, starred,
       acmg_classification, acmg_evidence, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const r of plan.inserts) {
    insert.run(
      r.chr,
      r.pos,
      r.ref,
      r.alt,
      r.genome_build,
      r.global_comment,
      r.starred,
      r.acmg_classification,
      r.acmg_evidence,
      r.created_at,
      r.updated_at
    )
  }
  const audit = db.prepare(
    `INSERT INTO audit_log (timestamp, action_type, entity_type, entity_key, old_value, new_value, user_name)
     VALUES (?, ?, 'variant_annotation', ?, ?, ?, ?)`
  )
  for (const a of plan.audits) {
    audit.run(
      now,
      'acmg_classify',
      a.key,
      JSON.stringify({ acmg_classification: a.discarded }),
      JSON.stringify({ acmg_classification: a.kept, reason: `allele_trim of ${a.from}` }),
      ALLELE_TRIM_MIGRATION_USER
    )
  }
  for (const a of plan.evidenceAudits) {
    audit.run(
      now,
      'acmg_evidence_update',
      a.key,
      JSON.stringify({ acmg_evidence: a.discarded }),
      JSON.stringify({ acmg_evidence: a.kept }),
      ALLELE_TRIM_MIGRATION_USER
    )
  }
}

export function migrateAlleleTrim(db: Db, now = Date.now()): void {
  const columns = new Set(
    (db.prepare('PRAGMA table_info(variants)').all() as { name: string }[]).map((c) => c.name)
  )
  // Bare legacy shapes (tests, pre-v23 fragments) have no alleles to trim.
  if (!['pos', 'ref', 'alt', 'variant_type'].every((c) => columns.has(c))) return
  db.transaction(() => {
    let changed = trimVariants(db)
    if (hasTable(db, 'variant_annotations')) {
      const plan = planAnnotationTrim(annotationRows(db))
      applyAnnotationPlan(db, plan, now)
      changed += plan.moves.length + plan.inserts.length
    }
    if (changed > 0 && hasTable(db, 'cohort_summary_meta')) db.exec(MARK_STALE_SQL)
  })()
}
