/**
 * Real-PostgreSQL coverage that every Postgres writer of case_data_info
 * supplies the NOT NULL created_at/updated_at columns (the SQLite worker
 * path did not — see tests/main/workers/import-pipeline.test.ts).
 *
 * Gated by VARLENS_RUN_POSTGRES_E2E=1. Requires a reachable VARLENS_PG_URL.
 */
import { randomBytes } from 'node:crypto'

import { Client, Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { PostgresCaseMetadataRepository } from '../../../src/main/storage/postgres/PostgresCaseMetadataRepository'
import { PostgresJsonImportRepository } from '../../../src/main/storage/postgres/PostgresJsonImportRepository'
import { PostgresVcfImportRepository } from '../../../src/main/storage/postgres/PostgresVcfImportRepository'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

describe.skipIf(!RUN)('Postgres case_data_info writers — real instance', () => {
  const schema = `vl_cdi_${Date.now()}_${randomBytes(4).toString('hex')}`
  let pool: Pool
  let client: Client

  beforeAll(async () => {
    const provisioner = new Client({ connectionString: PG_URL })
    await provisioner.connect()
    await provisioner.query(`CREATE SCHEMA "${schema}"`)
    await provisioner.end()
    pool = new Pool({ connectionString: PG_URL, max: 2 })
    client = new Client({ connectionString: PG_URL })
    await client.connect()
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
  }, 60_000)

  afterAll(async () => {
    if (client) await client.end()
    if (pool) await pool.end()
    const cleaner = new Client({ connectionString: PG_URL })
    await cleaner.connect()
    await cleaner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await cleaner.end()
  }, 60_000)

  async function dataInfo(caseId: number): Promise<Record<string, unknown>> {
    const res = await client.query(
      `SELECT import_file_name, import_file_type, platform, created_at::float8 AS created_at,
              updated_at::float8 AS updated_at
         FROM "${schema}"."case_data_info" WHERE case_id = $1`,
      [caseId]
    )
    expect(res.rows).toHaveLength(1)
    return res.rows[0] as Record<string, unknown>
  }

  it('JSON import writes provenance', async () => {
    const repo = new PostgresJsonImportRepository(pool, schema)
    const { caseId } = await repo.writeJsonImport(
      client as never,
      {
        filePath: '/tmp/a.json',
        fileName: 'a.json',
        caseName: 'json-case',
        fileSize: 1,
        genomeBuild: 'GRCh38',
        importFileType: 'object'
      },
      async () => {}
    )
    const row = await dataInfo(caseId)
    expect(row).toMatchObject({ import_file_name: 'a.json', import_file_type: 'object' })
    expect(row.created_at as number).toBeGreaterThan(0)
  })

  it('VCF single-file import and provisional finish write provenance', async () => {
    const repo = new PostgresVcfImportRepository(schema)
    const { caseId } = await repo.writeVcfFile(client as never, {
      mode: 'single-file',
      caseName: 'vcf-case',
      fileName: 'b.vcf.gz',
      filePath: '/tmp/b.vcf.gz',
      fileSize: 1,
      genomeBuild: 'GRCh38',
      caller: null,
      annotationFormat: null,
      variantType: 'snv',
      variants: [],
      transcripts: [],
      sv: [],
      cnv: [],
      str: []
    })
    expect(await dataInfo(caseId)).toMatchObject({
      import_file_name: 'b.vcf.gz',
      import_file_type: 'vcf'
    })

    const provisional = await repo.beginProvisionalImport(client as never, {
      caseName: 'provisional-case',
      filePath: '/tmp/c.vcf.gz',
      fileSize: 1,
      genomeBuild: 'GRCh38'
    })
    await repo.finishProvisionalImport(client as never, provisional.caseId, 'c.vcf.gz', 'vcf')
    expect(await dataInfo(provisional.caseId)).toMatchObject({ import_file_name: 'c.vcf.gz' })
  })

  it('metadata upsert creates then updates the row without losing provenance', async () => {
    const created = await client.query<{ id: string }>(
      `INSERT INTO "${schema}"."cases" (name, file_path, file_size, variant_count, created_at)
       VALUES ('meta-case', '/tmp/d.json', 1, 0, 1) RETURNING id`
    )
    const caseId = Number(created.rows[0].id)
    const repo = new PostgresCaseMetadataRepository(pool, schema)
    await repo.upsertCaseDataInfo(caseId, { platform: 'WES' })
    const first = await dataInfo(caseId)
    expect(first).toMatchObject({ platform: 'WES' })
    expect(first.created_at as number).toBeGreaterThan(0)
  })
})
