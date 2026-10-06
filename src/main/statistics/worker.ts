import { parentPort } from 'worker_threads'
import type { WorkerRequest, WorkerResponse } from './types'
import { computeGeneAssociation } from './gene-tests'

if (!parentPort) throw new Error('Must be run as worker thread')

parentPort.on('message', (request: WorkerRequest) => {
  if (request.type === 'run') {
    const total = request.genes.length

    for (let i = 0; i < request.genes.length; i++) {
      const gene = request.genes[i]

      try {
        parentPort!.postMessage({
          type: 'result',
          gene_symbol: gene.gene_symbol,
          result: computeGeneAssociation(gene, request.weight_scheme)
        } satisfies WorkerResponse)
      } catch (error) {
        parentPort!.postMessage({
          type: 'error',
          gene_symbol: gene.gene_symbol,
          error: error instanceof Error ? error.message : String(error)
        } satisfies WorkerResponse)
      }

      parentPort!.postMessage({
        type: 'progress',
        progress: { completed: i + 1, total }
      } satisfies WorkerResponse)
    }
  }
})
