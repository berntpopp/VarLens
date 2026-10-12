// Same message protocol as src/main/statistics/worker.ts, with test switches:
// a gene named CRASH exits the thread with code 3, HANG never answers.
import { parentPort } from 'node:worker_threads'
import { exit } from 'node:process'
import { setInterval } from 'node:timers'

parentPort.once('message', (request) => {
  if (request.genes.some((g) => g.gene_symbol === 'HANG')) {
    setInterval(() => {}, 1000)
    return
  }
  for (const gene of request.genes) {
    if (gene.gene_symbol === 'CRASH') exit(3)
    parentPort.postMessage({
      type: 'result',
      gene_symbol: gene.gene_symbol,
      result: { gene_symbol: gene.gene_symbol }
    })
    parentPort.postMessage({
      type: 'progress',
      progress: { completed: 1, total: request.genes.length }
    })
  }
})
