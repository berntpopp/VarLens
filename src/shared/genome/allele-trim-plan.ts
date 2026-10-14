/**
 * The allele-trim migration (#587; SQLite v57, PG 0040), decided once for both
 * backends. Imports store minimal alleles (trim-alleles.ts) since #587; rows
 * imported before keep the padded spelling a multi-allelic split left
 * (`ATT>AT`), so one allele had two keys. The backends feed the rows below and
 * apply the plan in the migration's transaction.
 *
 * - variants: small variants (snv/indel) are trimmed in place, with the import
 *   rule for their type; SV/CNV/STR rows keep their alleles, as at import.
 *   Two rows of one case that now share a key both stay: the summary counts a
 *   case once per key.
 * - variant_annotations: each row moves to its trimmed key (same build). Rows
 *   that land on one key merge (mergeAnnotationRowsAt: star kept, comments
 *   joined, newer classification with its evidence); every dropped
 *   classification or evidence is returned for audit_log.
 */
import { globalAnnotationEntityKey } from '../audit/annotation-entity-key'
import { isTrimmableVariantType, trimAlleles, trimmedVariantType } from '../utils/trim-alleles'
import {
  mergeAnnotationRowsAt,
  type AnnotationRow,
  type AnnotationValues,
  type GroupRemap
} from './annotation-remap'

export const ALLELE_TRIM_MIGRATION_USER = 'VarLens allele-trim migration'

/**
 * Rows trimAlleles can change (both alleles longer than one base, sharing the
 * first or the last base); the same SQL in SQLite and PostgreSQL. `table` is
 * an alias prefix such as `va.`.
 */
export function trimCandidateSql(table = ''): string {
  const [ref, alt] = [`${table}ref`, `${table}alt`]
  return `length(${ref}) > 1 AND length(${alt}) > 1
    AND (substr(${ref}, 1, 1) = substr(${alt}, 1, 1)
      OR substr(${ref}, length(${ref}), 1) = substr(${alt}, length(${alt}), 1))`
}

export interface VariantAlleles {
  id: number
  pos: number
  ref: string
  alt: string
  variant_type: string | null
}

/** The row's trimmed alleles and type; null when the import would store it as it is. */
export function trimVariantRow(row: VariantAlleles): VariantAlleles | null {
  if (!isTrimmableVariantType(row.variant_type)) return null
  const t = trimAlleles(row.pos, row.ref, row.alt)
  if (t.ref === row.ref && t.alt === row.alt) return null
  return { id: row.id, ...t, variant_type: trimmedVariantType(row.variant_type, t.ref, t.alt) }
}

export interface AnnotationTrimRow extends AnnotationRow {
  genome_build: string
  /** A SV/CNV/STR variant uses this key: it keeps its alleles, so the row stays. */
  locus_level: boolean
}

export interface AnnotationTrimPlan {
  /** A row alone at its trimmed key: re-keyed in place. */
  moves: Array<Pick<AnnotationRow, 'id' | 'pos' | 'ref' | 'alt'>>
  deleteIds: number[]
  inserts: AnnotationValues[]
  audits: GroupRemap['audits']
  evidenceAudits: ReturnType<typeof mergeAnnotationRowsAt>['evidenceAudits']
}

/** Plan the annotation re-keying from every `variant_annotations` row. */
export function planAnnotationTrim(rows: readonly AnnotationTrimRow[]): AnnotationTrimPlan {
  const keyOf = (r: Pick<AnnotationRow, 'chr' | 'pos' | 'ref' | 'alt'>, build: string): string =>
    globalAnnotationEntityKey(r, build)
  const byKey = new Map(rows.map((r) => [keyOf(r, r.genome_build), r]))
  const groups = new Map<string, { at: ReturnType<typeof trimAlleles>; rows: AnnotationRow[] }>()
  for (const row of rows) {
    if (row.locus_level) continue
    const at = trimAlleles(row.pos, row.ref, row.alt)
    if (at.ref === row.ref && at.alt === row.alt) continue
    const key = keyOf({ ...row, ...at }, row.genome_build)
    const group = groups.get(key) ?? { at, rows: [] }
    group.rows.push(row)
    groups.set(key, group)
  }
  const plan: AnnotationTrimPlan = {
    moves: [],
    deleteIds: [],
    inserts: [],
    audits: [],
    evidenceAudits: []
  }
  for (const [key, { at, rows: moving }] of groups) {
    const occupant = byKey.get(key)
    const sources = occupant === undefined ? moving : [occupant, ...moving]
    if (sources.length === 1) {
      plan.moves.push({ id: sources[0].id, ...at })
      continue
    }
    const { merged, audits, evidenceAudits } = mergeAnnotationRowsAt(sources, {
      chr: sources[0].chr,
      ...at
    })
    plan.deleteIds.push(...sources.map((r) => r.id))
    plan.inserts.push(merged)
    plan.audits.push(...audits)
    plan.evidenceAudits.push(...evidenceAudits)
  }
  return plan
}
