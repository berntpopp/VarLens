/**
 * Migration 0036 (#570) against a real PostgreSQL: built-in presets are
 * renamed after the clinical question they answer (mirrors SQLite v53).
 *
 * Gated by VARLENS_RUN_POSTGRES_E2E=1. Requires `make pg-up`.
 */
import { randomBytes } from 'node:crypto'

import { Client, Pool } from 'pg'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  BUILT_IN_PRESETS,
  BUILT_IN_PRESET_RENAMES_V53
} from '../../../src/shared/config/filter-presets.config'
import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

const BEFORE_0036 = POSTGRES_MIGRATIONS.filter((migration) => migration.version < '0036')
const THROUGH_0036 = POSTGRES_MIGRATIONS.filter((migration) => migration.version <= '0036')

describe.skipIf(!RUN)('migration 0036: built-in presets named by clinical question (#570)', () => {
  let schema: string
  let pool: Pool
  let probe: Client

  beforeEach(async () => {
    schema = `varlens_test_presets_${Date.now()}_${randomBytes(4).toString('hex')}`
    const provisioner = new Client({ connectionString: PG_URL })
    await provisioner.connect()
    await provisioner.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
    await provisioner.end()
    pool = new Pool({ connectionString: PG_URL, max: 2 })
    probe = new Client({ connectionString: PG_URL })
    await probe.connect()
  }, 120_000)

  afterEach(async () => {
    if (probe) await probe.end()
    if (pool) await pool.end()
    const cleaner = new Client({ connectionString: PG_URL })
    await cleaner.connect()
    await cleaner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await cleaner.end()
  }, 60_000)

  const builtIns = async (): Promise<unknown[]> =>
    (
      await probe.query(
        `SELECT name, description, is_visible FROM "${schema}".filter_presets
          WHERE is_built_in = 1 AND kind = 'filter' ORDER BY sort_order`
      )
    ).rows

  /** An existing schema, migrated before 0036 by a version with the old names. */
  async function oldSchema(): Promise<void> {
    await new PostgresMigrationRunner(pool, schema, BEFORE_0036).migrate()
    for (const [oldName, newName] of BUILT_IN_PRESET_RENAMES_V53) {
      await probe.query(
        `UPDATE "${schema}".filter_presets SET name = $1, description = 'old' WHERE name = $2`,
        [oldName, newName]
      )
    }
  }

  it('a new schema has every built-in preset with its config name and description', async () => {
    await new PostgresMigrationRunner(pool, schema, THROUGH_0036).migrate()
    expect(await builtIns()).toEqual(
      BUILT_IN_PRESETS.map((p) => ({ name: p.name, description: p.description, is_visible: 1 }))
    )
  }, 120_000)

  it('renames an existing schema, keeping visibility and user presets', async () => {
    await oldSchema()
    await probe.query(
      `UPDATE "${schema}".filter_presets SET is_visible = 0 WHERE name = 'Rare HIGH'`
    )
    await probe.query(
      `INSERT INTO "${schema}".filter_presets
         (name, description, filter_json, is_built_in, is_visible, sort_order, kind, created_at, updated_at)
       VALUES ('Known pathogenic', 'mine', '{}', 0, 1, 20, 'filter', 1, 1)`
    )

    const result = await new PostgresMigrationRunner(pool, schema, THROUGH_0036).migrate()

    expect(result.applied).toEqual(['0036'])
    expect(await builtIns()).toEqual(
      BUILT_IN_PRESETS.map((p) =>
        p.name === 'Known pathogenic'
          ? { name: 'ClinVar P/LP', description: 'old', is_visible: 1 }
          : {
              name: p.name,
              description: p.description,
              is_visible: p.name === 'Rare loss-of-function' ? 0 : 1
            }
      )
    )
    const mine = await probe.query(
      `SELECT description, is_built_in FROM "${schema}".filter_presets WHERE name = 'Known pathogenic'`
    )
    expect(mine.rows).toEqual([{ description: 'mine', is_built_in: 0 }])
  }, 120_000)
})
