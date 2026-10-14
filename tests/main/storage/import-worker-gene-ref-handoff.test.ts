/**
 * Both import worker clients hand the main thread's gene reference path to
 * their worker (workerData), where the SV/CNV/STR gene fallback reads it.
 */
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

const spawned = vi.hoisted(() => [] as Array<{ path: string; options: Record<string, unknown> }>)

vi.mock('../../../src/main/database/geneReferenceLoader', () => ({
  tryResolveGeneRefDbPath: () => '/resources/gene_reference.db'
}))

async function workerThreadsMock(
  importOriginal: () => Promise<Record<string, unknown>>
): Promise<Record<string, unknown>> {
  class FakeWorker extends EventEmitter {
    readonly postMessage = vi.fn()
    readonly terminate = vi.fn(async () => 0)
    constructor(path: string, options: Record<string, unknown>) {
      super()
      spawned.push({ path, options })
    }
  }
  return { ...(await importOriginal()), Worker: FakeWorker }
}
vi.mock('worker_threads', workerThreadsMock)
vi.mock('node:worker_threads', workerThreadsMock)

const { ImportWorkerClient } = await import('../../../src/main/workers/import-worker-client')
const { PostgresImportWorkerClient } =
  await import('../../../src/main/storage/postgres/PostgresImportWorkerClient')

describe('import worker clients pass the gene reference path', () => {
  it('SQLite import worker', () => {
    new ImportWorkerClient({ workerPath: '/out/import-worker.js' }).start({
      files: []
    } as never)
    expect(spawned.at(-1)?.options.workerData).toEqual({
      geneRefDbPath: '/resources/gene_reference.db'
    })
  })

  it('PostgreSQL import worker', () => {
    new PostgresImportWorkerClient({ workerPathCandidates: [__filename] }).start(
      { type: 'start' } as never,
      {} as never
    )
    expect(spawned.at(-1)).toMatchObject({
      path: __filename,
      options: { workerData: { geneRefDbPath: '/resources/gene_reference.db' } }
    })
  })
})
