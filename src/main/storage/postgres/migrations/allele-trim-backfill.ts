/**
 * afterApply step of migration 0040 (#587; SQLite twin: database/allele-trim-migration.ts):
 * rows imported before allele trimming get the minimal alleles an import
 * stores now, so old and new cases share one key. The decisions are in
 * shared/genome/allele-trim-plan.ts; the SQL file flags the cohort summary
 * for a rebuild. Runs in the migration's transaction; `coord_hash` and
 * `search_document` are generated columns and follow the update.
 */
import type { PoolClient } from 'pg'

import { serializeAuditContractValue } from '../../../../shared/audit/audit-contract'
import {
  ALLELE_TRIM_MIGRATION_USER,
  planAnnotationTrim,
  trimCandidateSql,
  trimVariantRow,
  type AnnotationTrimPlan,
  type AnnotationTrimRow,
  type VariantAlleles
} from '../../../../shared/genome/allele-trim-plan'
import { quoteIdentifier } from '../identifiers'

type QueryClient = Pick<PoolClient, 'query'>

/** Rows per UPDATE, so no single statement carries the whole backlog. */
const UPDATE_CHUNK = 10_000

async function trimVariants(client: QueryClient, tbl: (t: string) => string): Promise<void> {
  const { rows } = await client.query<{
    id: string
    pos: string
    ref: string
    alt: string
    variant_type: string
  }>(
    `SELECT id, pos, ref, alt, variant_type FROM ${tbl('variants_all')}
      WHERE variant_type IN ('snv', 'indel') AND ${trimCandidateSql()}`
  )
  const trimmed = rows
    .map((r) => trimVariantRow({ ...r, id: Number(r.id), pos: Number(r.pos) }))
    .filter((t): t is VariantAlleles => t !== null)
  for (let i = 0; i < trimmed.length; i += UPDATE_CHUNK) {
    const chunk = trimmed.slice(i, i + UPDATE_CHUNK)
    await client.query(
      `UPDATE ${tbl('variants_all')} v
          SET pos = u.pos, ref = u.ref, alt = u.alt, variant_type = u.variant_type
         FROM unnest($1::bigint[], $2::bigint[], $3::text[], $4::text[], $5::text[])
              AS u(id, pos, ref, alt, variant_type)
        WHERE v.id = u.id`,
      [
        chunk.map((t) => t.id),
        chunk.map((t) => t.pos),
        chunk.map((t) => t.ref),
        chunk.map((t) => t.alt),
        chunk.map((t) => t.variant_type)
      ]
    )
  }
}

/** Every annotation (the trimmed keys may already hold one); locus_level only matters for candidates. */
async function annotationRows(
  client: QueryClient,
  tbl: (t: string) => string
): Promise<AnnotationTrimRow[]> {
  const { rows } = await client.query<Record<string, unknown>>(
    `SELECT va.*, (${trimCandidateSql('va.')}) AND EXISTS (
       SELECT 1 FROM ${tbl('variants_all')} v
        WHERE v.chr = va.chr AND v.pos = va.pos AND v.ref = va.ref AND v.alt = va.alt
          AND v.variant_type NOT IN ('snv', 'indel')
     ) AS locus_level
     FROM ${tbl('variant_annotations')} va`
  )
  return rows.map((r) => ({
    id: Number(r.id),
    chr: String(r.chr),
    pos: Number(r.pos),
    ref: String(r.ref),
    alt: String(r.alt),
    genome_build: String(r.genome_build),
    global_comment: (r.global_comment as string | null) ?? null,
    starred: Number(r.starred),
    acmg_classification: (r.acmg_classification as string | null) ?? null,
    acmg_evidence: (r.acmg_evidence as string | null) ?? null,
    created_at: Number(r.created_at),
    updated_at: Number(r.updated_at),
    locus_level: r.locus_level === true
  }))
}

async function applyAnnotationPlan(
  client: QueryClient,
  schema: string,
  tbl: (t: string) => string,
  plan: AnnotationTrimPlan
): Promise<void> {
  for (const m of plan.moves) {
    await client.query(
      `UPDATE ${tbl('variant_annotations')} SET pos = $1, ref = $2, alt = $3 WHERE id = $4`,
      [m.pos, m.ref, m.alt, m.id]
    )
  }
  if (plan.deleteIds.length > 0) {
    await client.query(`DELETE FROM ${tbl('variant_annotations')} WHERE id = ANY($1::bigint[])`, [
      plan.deleteIds
    ])
  }
  for (const r of plan.inserts) {
    await client.query(
      `INSERT INTO ${tbl('variant_annotations')} (chr, pos, ref, alt, genome_build, global_comment,
         starred, acmg_classification, acmg_evidence, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
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
      ]
    )
  }
  const audit = (action: string, key: string, oldValue: object, newValue: object) =>
    client.query(
      `INSERT INTO varlens_audit."audit_log"
         (project_schema, action_type, entity_type, entity_key, old_value, new_value, user_name)
       VALUES ($1, $2, 'variant_annotation', $3, $4, $5, $6)`,
      [
        schema,
        action,
        key,
        serializeAuditContractValue(JSON.stringify(oldValue)),
        serializeAuditContractValue(JSON.stringify(newValue)),
        ALLELE_TRIM_MIGRATION_USER
      ]
    )
  for (const a of plan.audits) {
    await audit(
      'acmg_classify',
      a.key,
      { acmg_classification: a.discarded },
      { acmg_classification: a.kept, reason: `allele_trim of ${a.from}` }
    )
  }
  for (const a of plan.evidenceAudits) {
    await audit(
      'acmg_evidence_update',
      a.key,
      { acmg_evidence: a.discarded },
      { acmg_evidence: a.kept }
    )
  }
}

export async function trimStoredAlleles(client: QueryClient, schema: string): Promise<void> {
  const schemaName = quoteIdentifier(schema)
  const tbl = (t: string): string => `${schemaName}."${t}"`
  await trimVariants(client, tbl)
  await applyAnnotationPlan(client, schema, tbl, planAnnotationTrim(await annotationRows(client, tbl)))
}
