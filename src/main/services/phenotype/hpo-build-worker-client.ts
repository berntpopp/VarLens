/**
 * Runs the HPO preprocessing (JSON parse, closure, ~10^6 inserts) in a
 * one-shot worker so the main thread stays responsive. Falls back to
 * in-process when the bundled worker is absent (unit tests).
 */
import { Worker } from 'worker_threads'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import type { HpoAssetKey } from '../../../shared/config/hpo-data.config'
import { buildHpoSimilarityDb, type HpoBuildMeta } from './hpo-similarity-db'

export interface HpoBuildRequest {
  files: Record<HpoAssetKey, string>
  meta: HpoBuildMeta
  outPath: string
}

export type HpoBuildResponse = { type: 'done' } | { type: 'error'; error: string }

export function buildHpoFromFiles({ files, meta, outPath }: HpoBuildRequest): void {
  buildHpoSimilarityDb(
    {
      ontology: readFileSync(files.ontology, 'utf8'),
      annotations: readFileSync(files.annotations, 'utf8'),
      genes: readFileSync(files.genes, 'utf8')
    },
    meta,
    outPath
  )
}

export function runHpoBuild(request: HpoBuildRequest): Promise<void> {
  const workerPath = resolve(__dirname, 'hpo-build-worker.js')
  if (!existsSync(workerPath)) {
    buildHpoFromFiles(request)
    return Promise.resolve()
  }
  return new Promise((done, fail) => {
    const worker = new Worker(workerPath)
    let settled = false
    const finish = (error?: string): void => {
      if (settled) return
      settled = true
      if (error === undefined) done()
      else fail(new Error(`HPO data build failed: ${error}`))
      worker.terminate().catch(() => undefined)
    }
    worker.once('message', (msg: HpoBuildResponse) =>
      finish(msg.type === 'done' ? undefined : msg.error)
    )
    worker.once('error', (error: Error) => finish(error.message))
    worker.once('exit', (code) => finish(`worker exited with code ${code}`))
    worker.postMessage(request)
  })
}
