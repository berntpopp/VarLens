/**
 * SQLite triggers that keep the cohort summary's annotation flags (has_star,
 * has_comment, acmg_best) in step with `variant_annotations` and
 * `case_variant_annotations`. A summary row is one build's locus, so both the
 * global annotations (keyed by build since v52, #577) and the per-case ones
 * (through their case's build) count only for the row of their own build.
 *
 * Replaces the build-blind v13 triggers (migrations.ts) at v52.
 */
import type Database from 'better-sqlite3-multiple-ciphers'

import { acmgLabelCaseSql, acmgRankCaseSql } from '../../shared/config/severity.config'

const ROW = 'cohort_variant_summary'

const GLOBAL_AT_ROW = `va.chr = ${ROW}.chr AND va.pos = ${ROW}.pos AND va.ref = ${ROW}.ref
              AND va.alt = ${ROW}.alt AND va.genome_build = ${ROW}.genome_build`

const PER_CASE_AT_ROW = `FROM case_variant_annotations cva
              JOIN variants v ON cva.variant_id = v.id
              JOIN cases c ON c.id = v.case_id
              WHERE v.chr = ${ROW}.chr AND v.pos = ${ROW}.pos AND v.ref = ${ROW}.ref
              AND v.alt = ${ROW}.alt AND c.genome_build = ${ROW}.genome_build`

/** SET list recomputing the three flags of the summary row being updated. */
const FLAGS_SET = `
          has_star = CASE WHEN EXISTS(
              SELECT 1 FROM variant_annotations va WHERE ${GLOBAL_AT_ROW} AND va.starred = 1
            ) OR EXISTS(SELECT 1 ${PER_CASE_AT_ROW} AND cva.starred = 1)
            THEN 1 ELSE 0 END,
          has_comment = CASE WHEN EXISTS(
              SELECT 1 FROM variant_annotations va WHERE ${GLOBAL_AT_ROW}
              AND va.global_comment IS NOT NULL AND va.global_comment != ''
            ) OR EXISTS(SELECT 1 ${PER_CASE_AT_ROW}
              AND cva.per_case_comment IS NOT NULL AND cva.per_case_comment != '')
            THEN 1 ELSE 0 END,
          acmg_best = (
            SELECT ${acmgLabelCaseSql('MAX(rank)')}
            FROM (
              SELECT ${acmgRankCaseSql('va.acmg_classification')} AS rank
              FROM variant_annotations va WHERE ${GLOBAL_AT_ROW}
              AND va.acmg_classification IS NOT NULL
              UNION ALL
              SELECT ${acmgRankCaseSql('cva.acmg_classification')} ${PER_CASE_AT_ROW}
              AND cva.acmg_classification IS NOT NULL
            )
          )`

function globalTrigger(event: 'INSERT' | 'UPDATE' | 'DELETE'): string {
  const row = event === 'DELETE' ? 'OLD' : 'NEW'
  const when =
    event === 'UPDATE'
      ? `WHEN OLD.starred != NEW.starred
        OR OLD.global_comment IS NOT NEW.global_comment
        OR OLD.acmg_classification IS NOT NEW.acmg_classification`
      : ''
  return `
    CREATE TRIGGER trg_va_after_${event.toLowerCase()}
    AFTER ${event} ON variant_annotations
    FOR EACH ROW ${when}
    BEGIN
      UPDATE ${ROW} SET ${FLAGS_SET}
      WHERE chr = ${row}.chr AND pos = ${row}.pos AND ref = ${row}.ref AND alt = ${row}.alt
        AND genome_build = ${row}.genome_build;
    END`
}

function perCaseTrigger(event: 'INSERT' | 'UPDATE' | 'DELETE'): string {
  const row = event === 'DELETE' ? 'OLD' : 'NEW'
  const when =
    event === 'UPDATE'
      ? `WHEN OLD.starred != NEW.starred
        OR OLD.per_case_comment IS NOT NEW.per_case_comment
        OR OLD.acmg_classification IS NOT NEW.acmg_classification`
      : ''
  return `
    CREATE TRIGGER trg_cva_after_${event.toLowerCase()}
    AFTER ${event} ON case_variant_annotations
    FOR EACH ROW ${when}
    BEGIN
      -- Every build's row of the coordinate (each recomputed for its own build):
      -- a case delete cascades here after its cases row is already gone.
      UPDATE ${ROW} SET ${FLAGS_SET}
      WHERE (chr, pos, ref, alt) IN (
        SELECT chr, pos, ref, alt FROM variants WHERE id = ${row}.variant_id
      );
    END`
}

const EVENTS = ['INSERT', 'UPDATE', 'DELETE'] as const

/** Names of the six flag triggers (dropped before `variant_annotations` is rebuilt). */
export const ANNOTATION_FLAG_TRIGGERS = EVENTS.flatMap((e) => [
  `trg_va_after_${e.toLowerCase()}`,
  `trg_cva_after_${e.toLowerCase()}`
])

export function dropAnnotationFlagTriggers(db: Database.Database): void {
  for (const name of ANNOTATION_FLAG_TRIGGERS) db.exec(`DROP TRIGGER IF EXISTS ${name}`)
}

/** (Re)create the six build-aware flag triggers. */
export function createAnnotationFlagTriggers(db: Database.Database): void {
  dropAnnotationFlagTriggers(db)
  for (const event of EVENTS) {
    db.exec(globalTrigger(event))
    db.exec(perCaseTrigger(event))
  }
}
