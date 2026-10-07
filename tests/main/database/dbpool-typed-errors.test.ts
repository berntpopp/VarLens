/**
 * Typed errors must survive the read pool. Piscina structured-clones a thrown
 * error, which keeps the message but drops the class, `code` and
 * `userMessage` — so without the codec a user-facing filter error reaches the
 * renderer as "An unexpected error occurred". Runs against the real
 * `db-worker.ts` (bundled with esbuild, no `out/` build needed).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseService } from '../../../src/main/database/DatabaseService'
import { DbPool } from '../../../src/main/database/DbPool'
import { toSerializableError } from '../../../src/main/ipc/serializable-error'
import { ColumnFilterValueError } from '../../../src/shared/filters/column-filter-validation'
import { PanelRegionsUnavailableError } from '../../../src/shared/filters/panel-intervals'
import { ErrorCode } from '../../../src/shared/types/errors'
import { bundleWorker } from '../../utils/bundle-worker'

const GENE_REFERENCE_DB = resolve(process.cwd(), 'resources/gene_reference.db')

describe('DbPool typed error transport', () => {
  let dir: string
  let pool: DbPool
  let caseId: number
  let panelId: number

  beforeAll(async () => {
    const workerPath = await bundleWorker('src/main/workers/db-worker.ts')
    dir = mkdtempSync(join(tmpdir(), 'varlens-dbpool-errors-'))
    const path = join(dir, 'a.db')
    const db = new DatabaseService(path)
    caseId = db.cases.createCase('typed-errors', '/path/typed-errors.vcf', 1, 'GRCh38')
    panelId = db.panels.createPanel({ name: 'brca', source: 'manual' }).id
    db.panels.setGenes(panelId, [{ hgncId: 'HGNC:1100', symbol: 'BRCA1' }])
    db.close()

    pool = new DbPool()
    pool.init(path, undefined, { workerPath, maxThreads: 1, geneRefDbPath: GENE_REFERENCE_DB })
  }, 60_000)

  afterAll(async () => {
    await pool.destroy()
    rmSync(dir, { recursive: true, force: true })
  })

  const caught = async (run: Promise<unknown>): Promise<unknown> =>
    run.then(
      () => {
        throw new Error('expected the read to be rejected')
      },
      (error: unknown) => error
    )

  it('restores a panel that has genes but no regions for the build as a user-facing error', async () => {
    const error = await caught(
      pool.run({
        type: 'variants:query',
        params: [
          { case_id: caseId, active_panel_ids: [panelId], genome_build: 'NO_SUCH_BUILD' },
          10,
          0
        ]
      })
    )

    expect(error).toBeInstanceOf(PanelRegionsUnavailableError)
    const envelope = toSerializableError(error)
    expect(envelope.code).toBe(ErrorCode.VALIDATION)
    expect(envelope.userMessage).toContain('The active gene panel cannot be applied')
    expect(envelope.userMessage).toContain('NO_SUCH_BUILD')
  })

  it('restores the same error for the cohort listing', async () => {
    const error = await caught(
      pool.run({
        type: 'cohort:variants',
        params: [{ active_panel_ids: [panelId], genome_build: 'NO_SUCH_BUILD' }]
      })
    )
    expect(error).toBeInstanceOf(PanelRegionsUnavailableError)
  })

  it('restores an invalid numeric column filter value as a validation error', async () => {
    const error = await caught(
      pool.run({
        type: 'variants:query',
        params: [
          { case_id: caseId, column_filters: { cadd: { operator: '<', value: 'abc' } } },
          10,
          0
        ]
      })
    )

    expect(error).toBeInstanceOf(ColumnFilterValueError)
    expect(toSerializableError(error)).toMatchObject({
      code: ErrorCode.VALIDATION,
      userMessage: 'Invalid numeric value for column filter "cadd": "abc" is not a number'
    })
  })

  it('still rejects untyped failures with their original message', async () => {
    const error = await caught(pool.run({ type: 'no-such-task', params: [] } as never))
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch(/Unknown db-worker task type/)
  })
})
