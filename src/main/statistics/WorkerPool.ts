import { Worker } from 'worker_threads'
import { resolve } from 'path'
import os from 'os'
import { mainLogger } from '../services/MainLogger'
import type {
  GeneContingencyData,
  GeneAssociationResult,
  WeightScheme,
  WorkerRequest,
  WorkerResponse
} from './types'

export class WorkerPool {
  private maxThreads: number
  private workerPath: string
  private aborted = false
  private live = new Set<Worker>()

  constructor(maxThreads?: number, workerPath = resolve(__dirname, 'statistics-worker.js')) {
    const cpus = os.cpus().length
    this.maxThreads = maxThreads ?? Math.max(1, cpus - 1)
    this.workerPath = workerPath
  }

  async run(
    genes: GeneContingencyData[],
    weightScheme: WeightScheme,
    onProgress?: (completed: number, total: number) => void
  ): Promise<GeneAssociationResult[]> {
    this.aborted = false

    if (genes.length === 0) return []

    const numWorkers = genes.length < 20 ? 1 : Math.min(this.maxThreads, genes.length)
    const batches = splitIntoBatches(genes, numWorkers)
    const results: GeneAssociationResult[] = []
    let totalCompleted = 0

    const workerPromises = batches.map((batch) => {
      return new Promise<GeneAssociationResult[]>((resolveWorker, rejectWorker) => {
        if (this.aborted) {
          resolveWorker([])
          return
        }

        const worker = new Worker(this.workerPath)
        this.live.add(worker)
        const batchResults: GeneAssociationResult[] = []

        worker.on('message', (msg: WorkerResponse) => {
          if (this.aborted) {
            worker.terminate()
            resolveWorker(batchResults)
            return
          }

          if (msg.type === 'result' && msg.result) {
            batchResults.push(msg.result)
          } else if (msg.type === 'progress' && msg.progress) {
            totalCompleted++
            onProgress?.(totalCompleted, genes.length)
          } else if (msg.type === 'error') {
            mainLogger.error(`Worker error for gene ${msg.gene_symbol}: ${msg.error}`, 'statistics')
          }
        })

        worker.on('error', (err) => rejectWorker(err))
        worker.on('exit', (code) => {
          this.live.delete(worker)
          // A crash must not pass for a finished batch; terminate() on abort exits non-zero too.
          if (code !== 0 && !this.aborted) {
            rejectWorker(new Error(`Statistics worker exited with code ${code}`))
          } else {
            resolveWorker(batchResults)
          }
        })

        worker.postMessage({
          type: 'run',
          genes: batch,
          weight_scheme: weightScheme
        } satisfies WorkerRequest)
      })
    })

    const batchResults = await Promise.all(workerPromises)
    for (const batch of batchResults) {
      results.push(...batch)
    }

    return results
  }

  abort(): void {
    this.aborted = true
    for (const worker of this.live) void worker.terminate()
  }
}

function splitIntoBatches<T>(items: T[], numBatches: number): T[][] {
  const batches: T[][] = Array.from({ length: numBatches }, () => [])
  for (let i = 0; i < items.length; i++) {
    batches[i % numBatches].push(items[i])
  }
  return batches
}
