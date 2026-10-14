/** One-shot worker: preprocess downloaded HPO files into hpo_similarity.db (#600). */
import { parentPort } from 'worker_threads'
import {
  buildHpoFromFiles,
  type HpoBuildRequest,
  type HpoBuildResponse
} from '../services/phenotype/hpo-build-worker-client'

if (!parentPort) throw new Error('Must be run as worker thread')
const port = parentPort

port.once('message', (request: HpoBuildRequest) => {
  let response: HpoBuildResponse
  try {
    response = { type: 'done', warnings: buildHpoFromFiles(request) }
  } catch (error) {
    response = { type: 'error', error: error instanceof Error ? error.message : String(error) }
  }
  port.postMessage(response)
})
