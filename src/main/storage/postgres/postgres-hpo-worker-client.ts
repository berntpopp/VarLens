/**
 * Postgres Hpo Worker Client
 *
 * Runs HPO scoring, prewarming, and explanation in a dedicated off-thread Worker
 * (node:worker_threads) with LRU caching.
 */
import { Worker } from 'node:worker_threads'
import { resolve } from 'node:path'
import type { GenePhenotypeScore } from '../../services/phenotype/hpo-similarity-db'
import type { HpoProfileTerm } from '../../../shared/types/hpo-profile'

export interface HpoWorkerResponse<T = unknown> {
  id: number
  ok: boolean
  result?: T
  error?: string
  threadId: number
  cacheHit?: boolean
  cacheHits?: number
}

export interface ScoreAllGenesMetaResult {
  scores: GenePhenotypeScore[]
  threadId: number
  cacheHit: boolean
  cacheHits: number
}

export class PostgresHpoWorkerClient {
  private worker: Worker | null = null
  private nextId = 1
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void
      reject: (reason: unknown) => void
    }
  >()

  constructor(private readonly modulePath?: string) {}

  private getWorker(): Worker {
    if (this.worker !== null) return this.worker

    const resolvedModulePath =
      this.modulePath ?? resolve(process.cwd(), 'src/main/services/phenotype/hpo-similarity-db.ts')

    const bootstrapCode = `
      const { parentPort, threadId, workerData } = require('node:worker_threads');
      const { resolve } = require('node:path');

      let hpo;
      const candidates = [
        workerData?.hpoModulePath,
        resolve(__dirname, '../../services/phenotype/hpo-similarity-db.js'),
        resolve(process.cwd(), 'out/main/index.js'),
        resolve(process.cwd(), 'src/main/services/phenotype/hpo-similarity-db.ts')
      ].filter(Boolean);

      for (const p of candidates) {
        try {
          if (!p.endsWith('.ts')) {
            hpo = require(p);
            if (hpo && typeof hpo.scoreAllGenes === 'function') break;
          }
        } catch {}
      }

      if (!hpo || typeof hpo.scoreAllGenes !== 'function') {
        const { createJiti } = require('jiti');
        const jiti = createJiti(process.cwd() + '/index.js');
        for (const p of candidates) {
          try {
            hpo = jiti(p);
            if (hpo && typeof hpo.scoreAllGenes === 'function') break;
          } catch {}
        }
      }

      if (!hpo || typeof hpo.scoreAllGenes !== 'function') {
        throw new Error('Could not load hpo-similarity-db in worker thread');
      }

      const lruCache = new Map();
      const MAX_CACHE_SIZE = 100;
      let cacheHits = 0;

      parentPort.on('message', (msg) => {
        try {
          if (msg.type === 'ping') {
            parentPort.postMessage({ id: msg.id, ok: true, threadId, cacheHits });
          } else if (msg.type === 'prewarm') {
            const res = hpo.prewarmHpoIndex(msg.path);
            parentPort.postMessage({ id: msg.id, ok: true, result: res, threadId, cacheHits });
          } else if (msg.type === 'caseScores') {
            const cacheKey = JSON.stringify(msg.terms);
            let hit = false;
            let res;
            if (lruCache.has(cacheKey)) {
              res = lruCache.get(cacheKey);
              hit = true;
              cacheHits += 1;
              lruCache.delete(cacheKey);
              lruCache.set(cacheKey, res);
            } else {
              res = hpo.scoreAllGenes(msg.terms, msg.path);
              if (lruCache.size >= MAX_CACHE_SIZE) {
                const firstKey = lruCache.keys().next().value;
                lruCache.delete(firstKey);
              }
              lruCache.set(cacheKey, res);
            }
            parentPort.postMessage({
              id: msg.id,
              ok: true,
              result: res,
              threadId,
              cacheHit: hit,
              cacheHits
            });
          } else if (msg.type === 'explainGene') {
            const res = hpo.explainCaseGene(msg.caseTerms, msg.gene);
            parentPort.postMessage({ id: msg.id, ok: true, result: res, threadId, cacheHits });
          } else if (msg.type === 'stats') {
            parentPort.postMessage({
              id: msg.id,
              ok: true,
              threadId,
              cacheHits,
              cacheSize: lruCache.size
            });
          }
        } catch (err) {
          parentPort.postMessage({
            id: msg.id,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
            threadId,
            cacheHits
          });
        }
      });
    `

    const worker = new Worker(bootstrapCode, {
      eval: true,
      workerData: { hpoModulePath: resolvedModulePath }
    })
    worker.unref()

    worker.on('message', (response: HpoWorkerResponse) => {
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
      for (const [, handler] of this.pending) {
        handler.reject(err)
      }
      this.pending.clear()
      this.worker = null
    })

    worker.on('exit', () => {
      this.worker = null
    })

    this.worker = worker
    return worker
  }

  private send<T>(msg: Record<string, unknown>): Promise<HpoWorkerResponse<T>> {
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

  async scoreAllGenesWithMeta(
    terms: readonly HpoProfileTerm[],
    path?: string
  ): Promise<ScoreAllGenesMetaResult> {
    const resp = await this.send<GenePhenotypeScore[]>({ type: 'caseScores', terms, path })
    return {
      scores: resp.result ?? [],
      threadId: resp.threadId,
      cacheHit: Boolean(resp.cacheHit),
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

  async getCacheHits(): Promise<number> {
    const resp = await this.send<{ cacheHits: number }>({ type: 'stats' })
    return resp.cacheHits ?? 0
  }

  async destroy(): Promise<void> {
    if (this.worker !== null) {
      const worker = this.worker
      this.worker = null
      await worker.terminate()
    }
  }
}
