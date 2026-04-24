import { describe, expect, it, vi } from 'vitest'

describe('DbPool lazy initialization', () => {
  it('does not load a missing worker during init-only lifecycle', async () => {
    vi.resetModules()
    const { DbPool } = await import('../../../src/main/database/DbPool')
    const pool = new DbPool()

    pool.init('/tmp/varlens-lazy.db', undefined, {
      workerPath: '/tmp/varlens-missing-db-worker.js',
      maxThreads: 1
    })

    expect(pool.isInitialised()).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 25))

    await pool.destroy()
  })
})
