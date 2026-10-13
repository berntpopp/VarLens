/**
 * ACMG class, points, override reason and latest comment in PostgreSQL
 * exports (#574; SQLite: tests/main/workers/export-pipeline.test.ts).
 *
 * Gated by VARLENS_RUN_POSTGRES_E2E=1. Requires `make pg-up`.
 */
import { randomBytes } from 'node:crypto'

import { Client, Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { PostgresExportRepository } from '../../../src/main/storage/postgres/PostgresExportRepository'
import {
  cohortAnnotationExportColumns,
  withAnnotationCells
} from '../../../src/main/storage/postgres/postgres-annotation-export'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

const EVIDENCE = JSON.stringify({
  pathogenic: [{ code: 'PVS1', strength: 'very_strong', confirmed: true }],
  benign: [],
  is_override: true,
  override_reason: 'Segregation'
})

describe.skipIf(!RUN)('annotation columns of PostgreSQL exports (#574)', () => {
  let schema: string
  let pool: Pool
  let probe: Client
  let caseId: number
  const t = (table: string): string => `"${schema}"."${table}"`

  beforeAll(async () => {
    schema = `varlens_test_annexport_${Date.now()}_${randomBytes(4).toString('hex')}`
    pool = new Pool({ connectionString: PG_URL, max: 3 })
    probe = new Client({ connectionString: PG_URL })
    await probe.connect()
    await probe.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
    caseId = Number(
      (
        await probe.query<{ id: string }>(
          `INSERT INTO ${t('cases_all')} (name, file_path, file_size, created_at, genome_build)
           VALUES ('c', '/tmp/c.json', 0, 0, 'GRCh38') RETURNING id`
        )
      ).rows[0].id
    )
    const variant = async (pos: number): Promise<number> =>
      Number(
        (
          await probe.query<{ id: string }>(
            `INSERT INTO ${t('variants_all')} (case_id, chr, pos, ref, alt, variant_type)
             VALUES ($1, 'chr1', $2, 'A', 'G', 'snv') RETURNING id`,
            [caseId, pos]
          )
        ).rows[0].id
      )
    const annotated = await variant(100)
    await variant(200)
    await probe.query(
      `INSERT INTO ${t('case_variant_annotations')} (case_id, variant_id, acmg_classification,
         acmg_evidence, per_case_comment, created_at, updated_at)
       VALUES ($1, $2, 'Benign', $3, 'case note', 0, 1)`,
      [caseId, annotated, EVIDENCE]
    )
    await probe.query(
      `INSERT INTO ${t('variant_annotations')} (chr, pos, ref, alt, genome_build,
         acmg_classification, acmg_evidence, global_comment, created_at, updated_at)
       VALUES ('chr1', 100, 'A', 'G', 'GRCh38', 'Pathogenic', NULL, 'newer global note', 0, 2),
              ('chr1', 100, 'A', 'G', 'GRCh37', 'Benign', NULL, 'GRCh37 note', 0, 9)`
    )
  }, 120_000)

  afterAll(async () => {
    await probe.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await probe.end()
    await pool.end()
  }, 60_000)

  it('a case export carries the case call, its comment and the global one of its build', async () => {
    const rows: Array<Record<string, unknown>> = []
    for await (const row of new PostgresExportRepository(pool, schema).streamVariantExportRows({
      case_id: caseId
    })) {
      rows.push(row)
    }
    const at = (pos: number) => rows.find((r) => Number(r.pos) === pos)
    expect(at(100)).toMatchObject({
      acmg_classification: 'Benign',
      acmg_points: 8,
      acmg_override_reason: 'Segregation',
      case_comment: 'case note',
      global_comment: 'newer global note'
    })
    expect(at(200)).toMatchObject({ acmg_classification: null, case_comment: null })
    expect(at(100)).not.toHaveProperty('__own_annotation')
  }, 60_000)

  it('a cohort export carries the global call of the row build', async () => {
    await probe.query(
      `INSERT INTO ${t('cohort_variant_summary')}
         (chr, pos, ref, alt, variant_type, genome_build, carrier_count)
       VALUES ('chr1', 100, 'A', 'G', 'snv', 'GRCh38', 1), ('chr1', 100, 'A', 'G', 'snv', 'GRCh37', 1)`
    )
    const source = async function* () {
      const result = await pool.query(
        `SELECT cvs.genome_build, ${cohortAnnotationExportColumns(`"${schema}"`)}
           FROM ${t('cohort_variant_summary')} cvs ORDER BY cvs.genome_build`
      )
      yield* result.rows
    }
    const rows: Array<Record<string, unknown>> = []
    for await (const row of withAnnotationCells(source(), 'cohort')) rows.push(row)
    expect(rows).toEqual([
      {
        genome_build: 'GRCh37',
        acmg_classification: 'Benign',
        acmg_points: null,
        acmg_override_reason: null,
        global_comment: 'GRCh37 note'
      },
      {
        genome_build: 'GRCh38',
        acmg_classification: 'Pathogenic',
        acmg_points: null,
        acmg_override_reason: null,
        global_comment: 'newer global note'
      }
    ])
  }, 60_000)
})
