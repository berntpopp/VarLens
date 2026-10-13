/**
 * Rename one PostgreSQL case's contigs, with its global annotations, in the
 * caller's transaction (spec: .planning/specs/2026-10-12-chr-naming-per-build.md).
 * Used by the chromosome-name job (postgres-contig-naming.ts).
 *
 * The case's notes move in the same transaction as its variants, so every
 * read (which joins notes on the exact name) sees a case before or after its
 * rename, never notes and variants apart, and an edit made while the case
 * waits moves with it. Other queued cases keep their names, except at a locus
 * where they would take one of this case's new keys while giving up theirs
 * (a swap or chain: GRCh38 `1` <-> hg19 `chr1`): their variant and notes at
 * that locus move now too, so each note stays with its own locus.
 */
import type { PoolClient } from 'pg'

import { serializeAuditContractValue } from '../../../shared/audit/audit-contract'
import {
  annotationGroupKey,
  remapAnnotationGroup,
  type AnnotationRow,
  type GroupRemap,
  type KeyUsage
} from '../../../shared/genome/annotation-remap'
import type { ContigRename } from '../../../shared/genome/contig-naming-plan'
import { contigQueryNames } from '../../../shared/utils/contig'

type QueryClient = Pick<PoolClient, 'query'>
type Locus = { pos: number; ref: string; alt: string }

export const CONTIG_MIGRATION_USER = 'VarLens chromosome-name migration'
const tblOf = (schema: string) => (table: string) => `"${schema}"."${table}"`

const toRow = (r: Record<string, unknown>): AnnotationRow => ({
  id: Number(r.id),
  chr: String(r.chr),
  pos: Number(r.pos),
  ref: String(r.ref),
  alt: String(r.alt),
  global_comment: (r.global_comment as string | null) ?? null,
  starred: Number(r.starred),
  acmg_classification: (r.acmg_classification as string | null) ?? null,
  acmg_evidence: (r.acmg_evidence as string | null) ?? null,
  created_at: Number(r.created_at),
  updated_at: Number(r.updated_at)
})

/**
 * The renames that apply at one locus now: this case's, plus every queued
 * case that would take one of the new keys while leaving its own (repeated
 * until stable, for chains).
 */
export function activeRenames(
  caseId: number,
  pairs: readonly ContigRename[],
  usages: readonly KeyUsage[],
  queued: ReadonlyMap<number, readonly ContigRename[]>
): Map<number, readonly ContigRename[]> {
  const active = new Map<number, readonly ContigRename[]>([[caseId, pairs]])
  const nameOf = (u: KeyUsage): string =>
    active.get(u.caseId)?.find((p) => p.from === u.chr)?.to ?? u.chr
  for (let changed = true; changed;) {
    changed = false
    const taken = new Set(usages.filter((u) => active.has(u.caseId)).map(nameOf))
    for (const u of usages) {
      const own = queued.get(u.caseId)
      if (active.has(u.caseId) || own === undefined || !taken.has(u.chr)) continue
      if (!own.some((p) => p.from === u.chr)) continue
      active.set(u.caseId, own)
      changed = true
    }
  }
  return active
}

async function applyGroupRemap(
  client: QueryClient,
  schema: string,
  remap: GroupRemap
): Promise<void> {
  const tbl = tblOf(schema)
  if (remap.deleteIds.length > 0) {
    await client.query(`DELETE FROM ${tbl('variant_annotations')} WHERE id = ANY($1::bigint[])`, [
      remap.deleteIds
    ])
  }
  for (const r of remap.inserts) {
    await client.query(
      `INSERT INTO ${tbl('variant_annotations')} (chr, pos, ref, alt, global_comment, starred,
         acmg_classification, acmg_evidence, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        r.chr,
        r.pos,
        r.ref,
        r.alt,
        r.global_comment,
        r.starred,
        r.acmg_classification,
        r.acmg_evidence,
        r.created_at,
        r.updated_at
      ]
    )
  }
  for (const a of remap.audits) {
    await client.query(
      `INSERT INTO varlens_audit."audit_log"
         (project_schema, action_type, entity_type, entity_key, old_value, new_value, user_name)
       VALUES ($1, 'acmg_classify', 'variant_annotation', $2, $3, $4, $5)`,
      [
        schema,
        a.key,
        serializeAuditContractValue(JSON.stringify({ acmg_classification: a.discarded })),
        serializeAuditContractValue(
          JSON.stringify({ acmg_classification: a.kept, reason: `contig_merge of ${a.from}` })
        ),
        CONTIG_MIGRATION_USER
      ]
    )
  }
}

/**
 * Rename a case's variants (all of them, or one locus). Only rows under an
 * old name are written.
 */
async function renameVariants(
  client: QueryClient,
  schema: string,
  caseId: number,
  pairs: readonly ContigRename[],
  locus?: Locus
): Promise<void> {
  const tbl = tblOf(schema)
  const at = locus === undefined ? '' : ' AND pos = $2 AND ref = $3 AND alt = $4'
  const atParams = locus === undefined ? [] : [locus.pos, locus.ref, locus.alt]
  for (const pair of pairs) {
    await client.query(
      `UPDATE ${tbl('variants_all')} SET chr = $${atParams.length + 2}
        WHERE case_id = $1${at} AND chr = $${atParams.length + 3}`,
      [caseId, ...atParams, pair.to, pair.from]
    )
  }
}

/** The annotation rows at the loci where this case renames, locked, by locus group. */
async function caseAnnotationGroups(
  client: QueryClient,
  schema: string,
  caseId: number,
  froms: readonly string[]
): Promise<AnnotationRow[][]> {
  const tbl = tblOf(schema)
  const spellings = [...new Set(froms.flatMap((f) => [f, ...contigQueryNames(f)]))]
  const locked = await client.query(
    `SELECT va.* FROM ${tbl('variant_annotations')} va
       JOIN (SELECT DISTINCT pos, ref, alt FROM ${tbl('variants_all')}
              WHERE case_id = $1 AND chr = ANY($2::text[])) k
         ON va.pos = k.pos AND va.ref = k.ref AND va.alt = k.alt
      WHERE va.chr = ANY($3::text[])
      ORDER BY va.id FOR UPDATE OF va`,
    [caseId, froms, spellings]
  )
  const groups = new Map<string, AnnotationRow[]>()
  for (const raw of locked.rows as Array<Record<string, unknown>>) {
    const row = toRow(raw)
    groups.set(annotationGroupKey(row), [...(groups.get(annotationGroupKey(row)) ?? []), row])
  }
  return [...groups.values()]
}

/** Planned renames of the given cases that are still queued (and planned). */
async function queuedRenames(
  client: QueryClient,
  schema: string,
  caseIds: readonly number[]
): Promise<Map<number, ContigRename[]>> {
  const rows = await client.query<{ case_id: string; pairs: ContigRename[] }>(
    `SELECT case_id, pairs FROM ${tblOf(schema)('contig_naming_pending')}
      WHERE case_id = ANY($1::bigint[]) AND pairs IS NOT NULL`,
    [caseIds]
  )
  return new Map(rows.rows.map((r) => [Number(r.case_id), r.pairs]))
}

/**
 * Rename one case: its notes (and a swap partner's at the same locus) first,
 * then its variants.
 */
export async function renameCaseWithAnnotations(
  client: QueryClient,
  schema: string,
  caseId: number,
  pairs: readonly ContigRename[]
): Promise<void> {
  if (pairs.length === 0) return
  const tbl = tblOf(schema)
  const froms = pairs.map((p) => p.from)
  for (const group of await caseAnnotationGroups(client, schema, caseId, froms)) {
    const names = [...new Set(group.flatMap((r) => [r.chr, ...contigQueryNames(r.chr)]))]
    const { pos, ref, alt } = group[0]
    const found = await client.query<{ case_id: string; chr: string }>(
      `SELECT DISTINCT case_id, chr FROM ${tbl('variants_all')}
        WHERE chr = ANY($1::text[]) AND pos = $2 AND ref = $3 AND alt = $4`,
      [names, pos, ref, alt]
    )
    const usages = found.rows.map((u) => ({ caseId: Number(u.case_id), chr: u.chr }))
    const others = [...new Set(usages.map((u) => u.caseId))].filter((id) => id !== caseId)
    const active = activeRenames(caseId, pairs, usages, await queuedRenames(client, schema, others))
    const newName = (id: number, chr: string): string =>
      active.get(id)?.find((p) => p.from === chr)?.to ?? chr
    const remap = remapAnnotationGroup(group, usages, newName)
    if (remap !== null) await applyGroupRemap(client, schema, remap)
    // A swap partner's variant at this locus moves with its notes.
    for (const [partner, partnerPairs] of active) {
      if (partner !== caseId) {
        await renameVariants(client, schema, partner, partnerPairs, { pos, ref, alt })
      }
    }
  }
  await renameVariants(client, schema, caseId, pairs)
}
