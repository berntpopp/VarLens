/**
 * DbPool re-initialisation and suspend/resume against the real `db-worker.ts`
 * (bundled with esbuild, so this suite runs without an `out/` build).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseService } from '../../../src/main/database/DatabaseService'
import { DbPool } from '../../../src/main/database/DbPool'
import type { DbTask } from '../../../src/shared/types/db-task'
import { bundleWorker } from '../../utils/bundle-worker'

const LIST_CASES: DbTask = { type: 'cases:list', params: [] }

function createDb(path: string, caseName: string, key?: string): void {
  const db = new DatabaseService(path, key)
  db.cases.createCase(caseName, `/path/${caseName}.vcf`, 1)
  db.close()
}

async function settledWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let settled = false
  promise.then(
    () => (settled = true),
    () => (settled = true)
  )
  await new Promise((resolve) => setTimeout(resolve, ms))
  return settled
}

describe('DbPool re-init and suspend/resume', () => {
  let workerPath: string
  let dir: string
  let pool: DbPool

  beforeAll(async () => {
    workerPath = await bundleWorker('src/main/workers/db-worker.ts')
  }, 60_000)

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'varlens-dbpool-suspend-'))
    pool = new DbPool()
  })

  afterEach(async () => {
    await pool.destroy()
    rmSync(dir, { recursive: true, force: true })
  })

  const names = async (): Promise<string[]> =>
    (await pool.run<Array<{ name: string }>>(LIST_CASES)).map((c) => c.name)

  it('applies a second init() instead of silently keeping the first configuration', async () => {
    createDb(join(dir, 'a.db'), 'from-a')
    createDb(join(dir, 'b.db'), 'from-b')

    pool.init(join(dir, 'a.db'), undefined, { workerPath, maxThreads: 1 })
    pool.init(join(dir, 'b.db'), undefined, { workerPath, maxThreads: 1 })

    expect(await names()).toEqual(['from-b'])
  })

  it('rejects init() while workers from the previous configuration are alive', async () => {
    createDb(join(dir, 'a.db'), 'from-a')
    pool.init(join(dir, 'a.db'), undefined, { workerPath, maxThreads: 1 })
    await names()

    expect(() => pool.init(join(dir, 'a.db'), 'other', { workerPath })).toThrow(/destroy\(\)/)
  })

  it('holds reads while suspended and serves them after resume()', async () => {
    createDb(join(dir, 'a.db'), 'from-a')
    pool.init(join(dir, 'a.db'), undefined, { workerPath, maxThreads: 1 })
    await names()

    await pool.suspend()
    const held = names()
    expect(await settledWithin(held, 100)).toBe(false)

    pool.resume(undefined)
    expect(await held).toEqual(['from-a'])
  })

  it('lets in-flight reads finish before suspend() resolves', async () => {
    createDb(join(dir, 'a.db'), 'from-a')
    pool.init(join(dir, 'a.db'), undefined, { workerPath, maxThreads: 1 })

    const inFlight = names()
    await pool.suspend()

    expect(await inFlight).toEqual(['from-a'])
    pool.resume(undefined)
  })

  it('respawns workers with the key passed to resume()', async () => {
    const path = join(dir, 'enc.db')
    createDb(path, 'encrypted', 'key-one')
    pool.init(path, 'wrong-key', { workerPath, maxThreads: 1 })
    await expect(names()).rejects.toThrow()

    await pool.suspend()
    pool.resume('key-one')

    expect(await names()).toEqual(['encrypted'])
  })

  it('fails held reads when the pool is destroyed while suspended', async () => {
    createDb(join(dir, 'a.db'), 'from-a')
    pool.init(join(dir, 'a.db'), undefined, { workerPath, maxThreads: 1 })

    await pool.suspend()
    const held = names()
    await pool.destroy()

    await expect(held).rejects.toThrow(/not initialized/)
  })
})
