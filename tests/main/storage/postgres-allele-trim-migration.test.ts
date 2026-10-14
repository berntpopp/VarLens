/**
 * Migration 0040 (#587) against a real PostgreSQL, the twin of the SQLite v57
 * test (migration-v57-allele-trim.test.ts): the same rows end the same way.
 *
 * Gated by VARLENS_RUN_POSTGRES_E2E=1. Requires `make pg-up`.
 */
import { randomBytes } from 'node:crypto'

import { Pool } from 'pg'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  ALLELE_TRIM_MIGRATION_USER,
  TRIM_PAGE_SIZE
} from '../../../src/shared/genome/allele-trim-plan'
import { trimStoredAlleles } from '../../../src/main/storage/postgres/migrations/allele-trim-backfill'
import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { PostgresCohortSummaryRepository } from '../../../src/main/storage/postgres/PostgresCohortSummaryRepository'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

describe.skipIf(!RUN)('migration 0040: minimal alleles for rows imported before #587', () => {
  let schema: string
  let pool: Pool

  beforeEach(async () => {
    schema = `varlens_test_0040_${randomBytes(4).toString('hex')}`
    pool = new Pool({ connectionString: PG_URL, max: 2 })
    await pool.query(`CREATE SCHEMA "${schema}"`)
    const before = POSTGRES_MIGRATIONS.filter((migration) => migration.version < '0040')
    await new PostgresMigrationRunner(pool, schema, before).migrate()
    const t = (name: string): string => `"${schema}"."${name}"`
    await pool.query(`
      INSERT INTO ${t('cases_all')} (id, name, file_path, file_size, created_at, genome_build)
        VALUES (1, 'old', '/a', 1, 0, 'GRCh38'), (2, 'new', '/b', 1, 0, 'GRCh38');
      INSERT INTO ${t('variants_all')} (case_id, chr, pos, ref, alt, gt_num, variant_type) VALUES
        (1, 'chr5', 100, 'ATT', 'AT', '0/1', 'indel'),
        (1, 'chr5', 100, 'AT', 'A', '1/1', 'indel'),
        (1, 'chr5', 200, 'ACG', 'ATG', '0/1', 'indel'),
        (1, 'chr5', 300, 'CAGCAACAG', 'CAGCAGCAG', '0/1', 'str'),
        (2, 'chr5', 100, 'AT', 'A', '0/1', 'indel');
      INSERT INTO ${t('variant_annotations')} (chr, pos, ref, alt, genome_build, global_comment,
        starred, acmg_classification, acmg_evidence, created_at, updated_at) VALUES
        ('chr5', 100, 'ATT', 'AT', 'GRCh38', 'old note', 1, 'Pathogenic', '{"old":1}', 5, 10),
        ('chr5', 100, 'AT', 'A', 'GRCh38', 'new note', 0, 'Likely benign', '{"new":1}', 15, 20),
        ('chr5', 200, 'ACG', 'ATG', 'GRCh38', 'snv note', 0, NULL, NULL, 1, 1),
        ('chr5', 300, 'CAGCAACAG', 'CAGCAGCAG', 'GRCh38', 'str note', 0, NULL, NULL, 1, 1);
    `)
  }, 120_000)

  afterEach(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await pool.end()
  }, 60_000)

  const variants = async () =>
    (
      await pool.query(
        `SELECT case_id::int, pos::int, ref, alt, variant_type
           FROM "${schema}".variants_all ORDER BY id`
      )
    ).rows
  const annotations = async () =>
    (
      await pool.query(
        `SELECT pos::int, ref, alt, global_comment, starred::int, acmg_classification,
                acmg_evidence, created_at::bigint::int, updated_at::bigint::int
           FROM "${schema}".variant_annotations ORDER BY pos`
      )
    ).rows
  const audits = async () =>
    (
      await pool.query(
        `SELECT action_type, entity_key, old_value, new_value, user_name
           FROM varlens_audit.audit_log WHERE project_schema = $1 ORDER BY id`,
        [schema]
      )
    ).rows

  it('trims, merges and audits like SQLite v57; the rebuild counts one key', async () => {
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()

    expect(await variants()).toEqual([
      { case_id: 1, pos: 100, ref: 'AT', alt: 'A', variant_type: 'indel' },
      { case_id: 1, pos: 100, ref: 'AT', alt: 'A', variant_type: 'indel' },
      { case_id: 1, pos: 201, ref: 'C', alt: 'T', variant_type: 'snv' },
      { case_id: 1, pos: 300, ref: 'CAGCAACAG', alt: 'CAGCAGCAG', variant_type: 'str' },
      { case_id: 2, pos: 100, ref: 'AT', alt: 'A', variant_type: 'indel' }
    ])
    expect(await annotations()).toEqual([
      {
        pos: 100,
        ref: 'AT',
        alt: 'A',
        global_comment: 'old note\n\nnew note',
        starred: 1,
        acmg_classification: 'Likely benign',
        acmg_evidence: '{"new":1}',
        created_at: 5,
        updated_at: 20
      },
      expect.objectContaining({ pos: 201, ref: 'C', alt: 'T', global_comment: 'snv note' }),
      expect.objectContaining({ pos: 300, ref: 'CAGCAACAG', global_comment: 'str note' })
    ])
    // The audit contract keeps classifications and reduces evidence to its presence.
    expect(await audits()).toEqual([
      {
        action_type: 'acmg_classify',
        entity_key: 'chr5:100:AT:A@GRCh38',
        old_value: JSON.stringify({ acmg_classification: 'Pathogenic' }),
        new_value: JSON.stringify({
          acmg_classification: 'Likely benign',
          reason: 'allele_trim of chr5:100:ATT:AT, chr5:100:AT:A'
        }),
        user_name: ALLELE_TRIM_MIGRATION_USER
      },
      {
        action_type: 'acmg_evidence_update',
        entity_key: 'chr5:100:AT:A@GRCh38',
        old_value: JSON.stringify({ acmg_evidence: { present: true } }),
        new_value: JSON.stringify({ acmg_evidence: { present: true } }),
        user_name: ALLELE_TRIM_MIGRATION_USER
      }
    ])

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await new PostgresCohortSummaryRepository().rebuild({ schema, client: client as never })
      await client.query('COMMIT')
    } finally {
      client.release()
    }
    expect(
      (
        await pool.query(
          `SELECT ref, alt, carrier_count::int, acmg_best, has_star::int
             FROM "${schema}".cohort_variant_summary WHERE pos = 100`
        )
      ).rows
    ).toEqual([{ ref: 'AT', alt: 'A', carrier_count: 2, acmg_best: 'Likely benign', has_star: 1 }])
  }, 120_000)

  it('trims every page of a large table', async () => {
    const rows = 2 * TRIM_PAGE_SIZE + 5
    await pool.query(
      `INSERT INTO "${schema}".variants_all (case_id, chr, pos, ref, alt, gt_num, variant_type)
       SELECT 2, 'chr9', i * 10, 'GCC', 'GC', '0/1', 'indel' FROM generate_series(1, $1) i`,
      [rows]
    )
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
    expect(
      (
        await pool.query(
          `SELECT ref, alt, COUNT(*)::int AS n FROM "${schema}".variants_all
            WHERE chr = 'chr9' GROUP BY 1, 2`
        )
      ).rows
    ).toEqual([{ ref: 'GC', alt: 'G', n: rows }])
  }, 120_000)

  it('is idempotent: a second run changes and audits nothing', async () => {
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
    const before = [await variants(), await annotations(), await audits()]
    await trimStoredAlleles(pool, schema)
    expect([await variants(), await annotations(), await audits()]).toEqual(before)
  }, 120_000)
})
