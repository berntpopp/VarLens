/**
 * Postgres Hpo Worker Client
 *
 * Runs HPO scoring, prewarming, and explanation in a dedicated off-thread Worker
 * (node:worker_threads) backed by hpo-similarity-worker.
 */
import { Worker } from 'node:worker_threads'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { GenePhenotypeScore } from '../../services/phenotype/hpo-similarity-db'
import type { HpoProfileTerm } from '../../../shared/types/hpo-profile'

export interface HpoWorkerResponse<T = unknown> {
  id: number
  ok: boolean
  result?: T
  error?: string
  threadId: number
  cacheHits?: number
}

export class PostgresHpoWorkerClient {
  private worker: Worker | null = null
  private nextId = 1
  private disposed = false
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void
      reject: (reason: unknown) => void
    }
  >()

  constructor(private readonly workerPathOverride?: string) {}

  private getWorker(): Worker {
    if (this.worker !== null) return this.worker

    const candidates = [
      this.workerPathOverride,
      resolve(__dirname, 'hpo-similarity-worker.cjs'),
      resolve(__dirname, 'hpo-similarity-worker.js'),
      resolve(process.cwd(), 'out/web/hpo-similarity-worker.cjs'),
      resolve(process.cwd(), 'out/main/hpo-similarity-worker.js')
    ].filter((p): p is string => Boolean(p))

    const builtPath = candidates.find((p) => existsSync(p)) ?? null

    let worker: Worker
    if (builtPath !== null) {
      worker = new Worker(builtPath)
    } else {
      const workerTsPath = resolve(process.cwd(), 'src/main/workers/hpo-similarity-worker.ts')
      const bootstrapCode = `
        const { createJiti } = require('jiti');
        const jiti = createJiti(process.cwd() + '/index.js');
        jiti(${JSON.stringify(workerTsPath)});
      `
      worker = new Worker(bootstrapCode, { eval: true })
    }

    worker.on('message', (response: HpoWorkerResponse) => {
      if (this.worker !== worker) return
      const handler = this.pending.get(response.id)
      if (!handler) return
      this.pending.delete(response.id)
      if (response.ok) {
        handler.resolve(response)
      } else {
        handler.reject(new Error(response.error ?? 'Unknown worker error'))
      }
    })

    worker.on('error', (err) => {
      if (this.worker !== worker) return
      this.worker = null
      const handlers = Array.from(this.pending.values())
      this.pending.clear()
      void worker.terminate().catch(() => undefined)
      for (const handler of handlers) {
        handler.reject(err)
      }
    })

    worker.on('exit', (code) => {
      if (this.worker !== worker) return
      this.worker = null
      if (!this.disposed) {
        const handlers = Array.from(this.pending.values())
        this.pending.clear()
        for (const handler of handlers) {
          handler.reject(new Error(`HPO worker exited (code ${code})`))
        }
      }
    })

    worker.unref()

    this.worker = worker
    return worker
  }

  private send<T>(msg: Record<string, unknown>): Promise<HpoWorkerResponse<T>> {
    if (this.disposed) {
      return Promise.reject(new Error('PostgresHpoWorkerClient has been destroyed'))
    }
    const id = this.nextId++
    const worker = this.getWorker()
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (val: unknown) => void,
        reject
      })
      worker.postMessage({ ...msg, id })
    })
  }

  async prewarm(path?: string): Promise<{ threadId: number; result: boolean }> {
    const resp = await this.send<boolean>({ type: 'prewarm', path })
    return { threadId: resp.threadId, result: Boolean(resp.result) }
  }

  async scoreAllGenes(
    terms: readonly HpoProfileTerm[],
    path?: string
  ): Promise<GenePhenotypeScore[]> {
    const resp = await this.send<GenePhenotypeScore[]>({ type: 'caseScores', terms, path })
    return resp.result ?? []
  }

  async scoreAllGenesWithThread(
    terms: readonly HpoProfileTerm[],
    path?: string
  ): Promise<{ scores: GenePhenotypeScore[]; threadId: number; cacheHits: number }> {
    const resp = await this.send<GenePhenotypeScore[]>({ type: 'caseScores', terms, path })
    return {
      scores: resp.result ?? [],
      threadId: resp.threadId,
      cacheHits: resp.cacheHits ?? 0
    }
  }

  async explainGene(caseTerms: unknown[], gene: string): Promise<unknown> {
    const resp = await this.send<unknown>({ type: 'explainGene', caseTerms, gene })
    return resp.result
  }

  async getThreadId(): Promise<number> {
    const resp = await this.send<{ threadId: number }>({ type: 'ping' })
    return resp.threadId
  }

  async destroy(): Promise<void> {
    this.disposed = true
    for (const [, handler] of this.pending) {
      handler.reject(new Error('PostgresHpoWorkerClient destroyed'))
    }
    this.pending.clear()
    if (this.worker !== null) {
      const worker = this.worker
      this.worker = null
      await worker.terminate()
    }
  }
}
