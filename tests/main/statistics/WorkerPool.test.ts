// @vitest-environment node
/**
 * WorkerPool against real worker threads (#545): a fixture with the statistics
 * worker's protocol that exits once its batch is posted, like worker.ts does.
 */
import { describe, it, expect, vi } from 'vitest'
import { resolve } from 'node:path'

vi.mock('../../../src/main/services/MainLogger', () => ({
  mainLogger: { error: () => {}, warn: () => {}, info: () => {} }
}))

import { WorkerPool } from '../../../src/main/statistics/WorkerPool'
import type { GeneContingencyData } from '../../../src/main/statistics/types'

const FIXTURE = resolve(__dirname, '../../fixtures/statistics/fake-statistics-worker.mjs')
const genes = (...names: string[]): GeneContingencyData[] =>
  names.map((gene_symbol) => ({ gene_symbol }) as GeneContingencyData)
const many = (n: number) => genes(...Array.from({ length: n }, (_, i) => `G${i}`))

describe('WorkerPool', { timeout: 10_000 }, () => {
  it('resolves one result per gene for a single worker', async () => {
    const results = await new WorkerPool(4, FIXTURE).run(genes('G0'), 'uniform')
    expect(results.map((r) => r.gene_symbol)).toEqual(['G0'])
  })

  it('resolves one result per gene across several workers', async () => {
    const onProgress = vi.fn()
    const results = await new WorkerPool(4, FIXTURE).run(many(25), 'uniform', onProgress)
    expect(new Set(results.map((r) => r.gene_symbol)).size).toBe(25)
    expect(onProgress).toHaveBeenLastCalledWith(25, 25)
  })

  it('rejects when a worker exits non-zero instead of returning partial results', async () => {
    await expect(new WorkerPool(4, FIXTURE).run(genes('G0', 'CRASH'), 'uniform')).rejects.toThrow(
      /exited with code 3/
    )
  })

  it('abort() terminates workers that never answer and settles the run', async () => {
    const pool = new WorkerPool(4, FIXTURE)
    const run = pool.run(genes('HANG'), 'uniform')
    await new Promise((r) => setTimeout(r, 100))
    pool.abort()
    await expect(run).resolves.toEqual([])
  })
})
