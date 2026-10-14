/**
 * Runs the HPO preprocessing (JSON parse, closure, ~10^5 inserts) in a
 * one-shot worker so the main thread stays responsive. Outside Electron
 * (unit tests) without the bundle it runs in-process; in Electron a missing
 * bundle is an error, never a silent main-thread build.
 */
import { Worker } from 'worker_threads'
import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
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

/**
 * The worker bundle sits next to the main entry (`out/main/index.js`); this
 * module is bundled into `out/main/chunks/` (the worker imports it), so its own
 * `__dirname` is the wrong anchor.
 */
export function hpoWorkerPath(mainFile = require.main?.filename): string | null {
  return mainFile === undefined ? null : join(dirname(mainFile), 'hpo-build-worker.js')
}

export function runHpoBuild(
  request: HpoBuildRequest,
  workerPath = hpoWorkerPath(),
  inElectron = process.versions.electron !== undefined
): Promise<void> {
  if (workerPath === null || !existsSync(workerPath)) {
    if (inElectron) {
      return Promise.reject(new Error(`HPO build worker bundle missing: ${workerPath}`))
    }
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
