/**
 * Where the global annotations (`variant_annotations`, keyed by chr:pos:ref:alt
 * without a build) go when cases are renamed to their build's contig names
 * (spec: .planning/specs/2026-10-12-chr-naming-per-build.md). Pure; both
 * backends feed it the rows and usages of one locus group and apply the result.
 *
 * A group is every spelling of one contig at one pos/ref/alt (`1`, `chr1`).
 * Each annotation row follows the cases that use its key: after the rename it
 * belongs at every key those cases then use (a copy when they differ), and a
 * key nobody uses keeps its row. Rows that land on one key are merged. The
 * decision is made for the whole group at once from the final names, so the
 * order cases are renamed in cannot mix two loci (a GRCh38 `1` and an hg19
 * `chr1` swap keys, each note stays with its own locus).
 */
import { globalAnnotationEntityKey } from '../audit/annotation-entity-key'
import { bareContig } from '../utils/contig'

/** The user-authored columns of a `variant_annotations` row. */
export interface GlobalAnnotationFields {
  global_comment: string | null
  starred: number
  acmg_classification: string | null
  acmg_evidence: string | null
  updated_at: number
}

export interface AnnotationRow extends GlobalAnnotationFields {
  id: number
  chr: string
  pos: number
  ref: string
  alt: string
  /** Part of the key since SQLite v52 / PG 0035 (#577); absent before. */
  genome_build?: string
  created_at: number
}

/** A case that holds a variant of the group under the name `chr`. */
export interface KeyUsage {
  caseId: number
  chr: string
}

export type AnnotationValues = Omit<AnnotationRow, 'id'>

export interface GroupRemap {
  deleteIds: number[]
  inserts: AnnotationValues[]
  /** A classification dropped by a merge, for audit_log; `from` lists the merged keys. */
  audits: Array<{ key: string; discarded: string; kept: string | null; from: string }>
}

/** Group key: one contig (any spelling) at one pos/ref/alt, in one build when keyed by build. */
export function annotationGroupKey(
  row: Pick<AnnotationRow, 'chr' | 'pos' | 'ref' | 'alt' | 'genome_build'>
): string {
  const build = row.genome_build === undefined ? '' : `@${row.genome_build}`
  return `${bareContig(row.chr)}:${row.pos}:${row.ref}:${row.alt}${build}`
}

/**
 * Merge two global annotations that land on one key: the star is kept, the
 * comments are joined, the newer classification (with its evidence) wins.
 * `discardedAcmg` is the other classification when both differ, for audit_log.
 */
export function mergeGlobalAnnotations(
  target: GlobalAnnotationFields,
  source: GlobalAnnotationFields
): Omit<GlobalAnnotationFields, 'updated_at'> & { discardedAcmg: string | null } {
  // Paragraphs, so a comment merged earlier is not repeated by a later merge.
  const comments = [target.global_comment, source.global_comment]
    .flatMap((c) => (c ?? '').split('\n\n'))
    .map((c) => c.trim())
    .filter((c) => c !== '')
  const [newer, older] = source.updated_at > target.updated_at ? [source, target] : [target, source]
  const kept = newer.acmg_classification !== null ? newer : older
  const other = kept === newer ? older : newer
  return {
    global_comment: comments.length === 0 ? null : [...new Set(comments)].join('\n\n'),
    starred: Math.max(target.starred, source.starred),
    acmg_classification: kept.acmg_classification,
    acmg_evidence: kept.acmg_evidence,
    discardedAcmg:
      other.acmg_classification !== null && other.acmg_classification !== kept.acmg_classification
        ? other.acmg_classification
        : null
  }
}

/**
 * Remap the annotation rows of one group. `newName` gives the name a case
 * uses after the rename (its current name when it is not renamed). Returns
 * null when no usage changes name, so the group is left alone.
 */
export function remapAnnotationGroup(
  rows: readonly AnnotationRow[],
  usages: readonly KeyUsage[],
  newName: (caseId: number, chr: string) => string
): GroupRemap | null {
  if (!usages.some((u) => newName(u.caseId, u.chr) !== u.chr)) return null
  const byTarget = new Map<string, AnnotationRow[]>()
  for (const row of rows) {
    const users = usages.filter((u) => u.chr === row.chr)
    const targets = users.length === 0 ? [row.chr] : users.map((u) => newName(u.caseId, u.chr))
    for (const target of new Set(targets))
      byTarget.set(target, [...(byTarget.get(target) ?? []), row])
  }
  const result: GroupRemap = { deleteIds: [], inserts: [], audits: [] }
  const untouched = new Set<number>()
  for (const [chr, sources] of byTarget) {
    if (sources.length === 1 && sources[0].chr === chr) {
      untouched.add(sources[0].id)
      continue
    }
    const ordered = [...sources].sort((a, b) => a.updated_at - b.updated_at)
    let merged: AnnotationValues = { ...ordered[0], chr }
    for (const next of ordered.slice(1)) {
      const m = mergeGlobalAnnotations(merged, next)
      const key = globalAnnotationEntityKey({ ...next, chr }, next.genome_build)
      if (m.discardedAcmg !== null) {
        result.audits.push({
          key,
          discarded: m.discardedAcmg,
          kept: m.acmg_classification,
          from: ordered.map((r) => `${r.chr}:${r.pos}:${r.ref}:${r.alt}`).join(', ')
        })
      }
      merged = {
        ...merged,
        global_comment: m.global_comment,
        starred: m.starred,
        acmg_classification: m.acmg_classification,
        acmg_evidence: m.acmg_evidence,
        created_at: Math.min(merged.created_at, next.created_at),
        updated_at: Math.max(merged.updated_at, next.updated_at)
      }
    }
    result.inserts.push(merged)
  }
  // A row kept as-is for its own key is not deleted, even if copied elsewhere.
  result.deleteIds = rows.filter((r) => !untouched.has(r.id)).map((r) => r.id)
  return result
}
