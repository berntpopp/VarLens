import { parentPort, threadId } from 'node:worker_threads'
import {
  explainCaseGene,
  getHpoCaseScoreCacheHits,
  prewarmHpoIndex,
  scoreAllGenes
} from '../services/phenotype/hpo-similarity-db'

if (!parentPort) throw new Error('Must be run as worker thread')
const port = parentPort

port.on('message', (msg: Record<string, unknown>) => {
  const id = msg.id as number
  try {
    if (msg.type === 'ping') {
      port.postMessage({ id, ok: true, threadId })
    } else if (msg.type === 'prewarm') {
      const result = prewarmHpoIndex(msg.path as string | undefined)
      port.postMessage({ id, ok: true, result, threadId })
    } else if (msg.type === 'caseScores') {
      const result = scoreAllGenes(
        msg.terms as Parameters<typeof scoreAllGenes>[0],
        msg.path as string | undefined
      )
      port.postMessage({
        id,
        ok: true,
        result,
        threadId,
        cacheHits: getHpoCaseScoreCacheHits()
      })
    } else if (msg.type === 'explainGene') {
      const result = explainCaseGene(
        msg.caseTerms as Parameters<typeof explainCaseGene>[0],
        msg.gene as string
      )
      port.postMessage({ id, ok: true, result, threadId })
    } else {
      throw new Error(`Unknown HPO worker message type: ${String(msg.type)}`)
    }
  } catch (err) {
    port.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      threadId
    })
  }
})
