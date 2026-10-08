/**
 * Migration 0028 (#455) against a real PostgreSQL: the built-in preset
 * "Rare, not recurrent" is added to an existing schema; every other preset
 * row stays as it is (mirrors SQLite v45).
 *
 * Gated by VARLENS_RUN_POSTGRES_E2E=1. Requires `make pg-up`.
 */
import { randomBytes } from 'node:crypto'

import { Client, Pool } from 'pg'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { RARE_NOT_RECURRENT_PRESET_NAME } from '../../../src/main/database/built-in-presets'
import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

const BEFORE_0028 = POSTGRES_MIGRATIONS.filter((migration) => migration.version < '0028')

describe.skipIf(!RUN)('migration 0028: built-in preset "Rare, not recurrent" (#455)', () => {
  let schema: string
  let pool: Pool
  let probe: Client

  beforeEach(async () => {
    schema = `varlens_test_preset_${Date.now()}_${randomBytes(4).toString('hex')}`
    const provisioner = new Client({ connectionString: PG_URL })
    await provisioner.connect()
    await provisioner.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
    await provisioner.end()

    pool = new Pool({ connectionString: PG_URL, max: 2 })
    probe = new Client({ connectionString: PG_URL })
    await probe.connect()

    // An existing schema: migrated before 0028, without the new preset (the
    // 0005 seed of this code version adds it, an older one did not).
    await new PostgresMigrationRunner(pool, schema, BEFORE_0028).migrate()
    await probe.query(`DELETE FROM "${schema}".filter_presets WHERE name = $1`, [
      RARE_NOT_RECURRENT_PRESET_NAME
    ])
  }, 120_000)

  afterEach(async () => {
    if (probe) await probe.end()
    if (pool) await pool.end()
    const cleaner = new Client({ connectionString: PG_URL })
    await cleaner.connect()
    await cleaner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await cleaner.end()
  }, 60_000)

  const preset = async (): Promise<unknown[]> =>
    (
      await probe.query(
        `SELECT name, description, filter_json, is_built_in, is_visible,
                sort_order::int AS sort_order, kind
           FROM "${schema}".filter_presets WHERE name = $1`,
        [RARE_NOT_RECURRENT_PRESET_NAME]
      )
    ).rows

  const otherRows = async (): Promise<unknown[]> =>
    (
      await probe.query(`SELECT * FROM "${schema}".filter_presets WHERE name != $1 ORDER BY id`, [
        RARE_NOT_RECURRENT_PRESET_NAME
      ])
    ).rows

  const migrate = (): Promise<{ applied: string[] }> =>
    new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()

  it('adds the preset and leaves every other row unchanged', async () => {
    await probe.query(
      `INSERT INTO "${schema}".filter_presets
         (name, description, filter_json, is_built_in, is_visible, sort_order, kind, created_at, updated_at)
       VALUES ('My rare set', 'mine', '{"maxGnomadAf":0.001,"maxCarriers":2}', 0, 1, 20, 'filter', 1, 1)`
    )
    await probe.query(
      `UPDATE "${schema}".filter_presets SET is_visible = 0 WHERE name = 'Rare (1%)'`
    )
    const before = await otherRows()

    const result = await migrate()

    expect(result.applied).toEqual(['0028'])
    expect(await preset()).toEqual([
      {
        name: 'Rare, not recurrent',
        description: 'gnomAD AF <= 1% + seen in at most 3 cases',
        filter_json: '{"maxGnomadAf":0.01,"maxCarriers":3}',
        is_built_in: 1,
        is_visible: 1,
        sort_order: 8,
        kind: 'filter'
      }
    ])
    expect(await otherRows()).toEqual(before)
  }, 120_000)

  // Review Focus 5
  it('keeps a user preset of the same name as it is', async () => {
    await probe.query(
      `INSERT INTO "${schema}".filter_presets
         (name, description, filter_json, is_built_in, is_visible, sort_order, kind, created_at, updated_at)
       VALUES ($1, 'my own', '{"minCadd":5}', 0, 1, 30, 'filter', 1, 1)`,
      [RARE_NOT_RECURRENT_PRESET_NAME]
    )

    await migrate()

    expect(await preset()).toEqual([
      {
        name: 'Rare, not recurrent',
        description: 'my own',
        filter_json: '{"minCadd":5}',
        is_built_in: 0,
        is_visible: 1,
        sort_order: 30,
        kind: 'filter'
      }
    ])
  }, 120_000)

  it('running the migrations again keeps one row', async () => {
    await migrate()
    await migrate()
    expect(await preset()).toHaveLength(1)
  }, 120_000)
})
