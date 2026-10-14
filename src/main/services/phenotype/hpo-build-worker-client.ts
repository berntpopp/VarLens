/**
 * Runs the HPO preprocessing (JSON parse, closure, ~10^5 inserts) in a
 * one-shot worker so the main thread stays responsive. Outside Electron
 * (unit tests) without the bundle it runs in-process; in Electron a missing
 * bundle is an error, never a silent main-thread build.
 */
import Database from 'better-sqlite3-multiple-ciphers'
import { Worker } from 'worker_threads'
import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import type { HpoAssetKey } from '../../../shared/config/hpo-data.config'
import { buildHpoSimilarityDb, type HpoBuildMeta } from './hpo-similarity-db'
import type { LocusSourceInput } from './locus-reference-db'

/** Optional CNV/STR sources as downloaded file paths (absent: download failed, see `errors`). */
export interface LocusBuildFiles extends Pick<
  LocusSourceInput,
  'versions' | 'errors' | 'previousPath'
> {
  clingen?: { genes: string; regions: Record<string, string> }
  strchive?: string
  mondo?: string
  /** bundled gene_reference.db, for ClinGen's NCBI Gene id → HGNC id */
  geneRefPath: string | null
}

export interface HpoBuildRequest {
  files: Record<HpoAssetKey, string>
  meta: HpoBuildMeta
  outPath: string
  locus?: LocusBuildFiles
}

export type HpoBuildResponse =
  { type: 'done'; warnings: string[] } | { type: 'error'; error: string }

const read = (path: string): string => readFileSync(path, 'utf8')

function entrezToHgnc(path: string | null): Map<string, string> {
  if (path === null || !existsSync(path)) return new Map()
  const db = new Database(path, { readonly: true, fileMustExist: true })
  try {
    const rows = db
      .prepare('SELECT entrez_id, hgnc_id FROM genes WHERE entrez_id IS NOT NULL')
      .raw()
      .all() as Array<[string, string]>
    return new Map(rows.map(([entrez, hgnc]) => [String(entrez), hgnc]))
  } finally {
    db.close()
  }
}

function locusInput(files: LocusBuildFiles): LocusSourceInput {
  const { clingen, strchive, mondo, geneRefPath, ...rest } = files
  return {
    ...rest,
    clingen:
      clingen === undefined
        ? undefined
        : {
            genes: read(clingen.genes),
            regions: Object.fromEntries(
              Object.entries(clingen.regions).map(([build, path]) => [build, read(path)])
            )
          },
    strchive: strchive === undefined ? undefined : read(strchive),
    mondo: mondo === undefined ? undefined : read(mondo),
    entrezToHgnc: entrezToHgnc(geneRefPath)
  }
}

/** Builds the DB; returns one warning per stale or missing optional source. */
export function buildHpoFromFiles({ files, meta, outPath, locus }: HpoBuildRequest): string[] {
  return buildHpoSimilarityDb(
    {
      ontology: read(files.ontology),
      annotations: read(files.annotations),
      genes: read(files.genes),
      locus: locus === undefined ? undefined : locusInput(locus)
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
): Promise<string[]> {
  if (workerPath === null || !existsSync(workerPath)) {
    if (inElectron) {
      return Promise.reject(new Error(`HPO build worker bundle missing: ${workerPath}`))
    }
    return Promise.resolve(buildHpoFromFiles(request))
  }
  return new Promise((done, fail) => {
    const worker = new Worker(workerPath)
    let settled = false
    const finish = (result: string[] | string): void => {
      if (settled) return
      settled = true
      if (typeof result !== 'string') done(result)
      else fail(new Error(`HPO data build failed: ${result}`))
      worker.terminate().catch(() => undefined)
    }
    worker.once('message', (msg: HpoBuildResponse) =>
      finish(msg.type === 'done' ? msg.warnings : msg.error)
    )
    worker.once('error', (error: Error) => finish(error.message))
    worker.once('exit', (code) => finish(`worker exited with code ${code}`))
    worker.postMessage(request)
  })
}
