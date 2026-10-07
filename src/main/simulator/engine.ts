/**
 * High-performance cohort simulation engine.
 * Orchestrates multi-worker parallel generation or single-thread execution.
 */
import { mkdirSync, renameSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { join, resolve } from 'node:path'
import { Worker } from 'node:worker_threads'
import { GeneCatalog } from './catalog'
import { createCohortSharedPool, generateSampleVariants } from './generator'
import { deriveSeed, DeterministicRandom } from './random'
import type {
  CanonicalVariant,
  CohortManifest,
  GeneratedSampleResult,
  SampleMetadata,
  SimulatorOptions,
  SimulatorProgress
} from './types'
import type { WorkerMessage, WorkerPayload } from './worker'
import { writeColumnarJson } from './writers/columnar-json-writer'
import { writeCohortFiles } from './writers/manifest-writer'
import { writeSimpleJson } from './writers/simple-json-writer'
import { writeVcf } from './writers/vcf-writer'
import { writeXlsx } from './writers/xlsx-writer'

const DEFAULT_MASTER_SEED = 20261006

export async function runSampleInProcess(
  idx: number,
  masterSeed: number,
  options: SimulatorOptions,
  catalog: GeneCatalog,
  sharedPool: CanonicalVariant[]
): Promise<GeneratedSampleResult> {
  const startTime = Date.now()
  const sampleSeed = deriveSeed(masterSeed, idx, 'sample')
  const rng = new DeterministicRandom(sampleSeed)

  let variantCount: number
  if (options.variantsPerSample !== undefined) {
    variantCount = options.variantsPerSample
  } else if (options.variantsMin !== undefined && options.variantsMax !== undefined) {
    variantCount = rng.intBetween(options.variantsMin, options.variantsMax)
  } else if (options.preset === 'panel') {
    variantCount = rng.intBetween(3550, 3900)
  } else if (options.preset === 'exome') {
    variantCount = rng.intBetween(25000, 35000)
  } else if (options.preset === 'smoke') {
    variantCount = rng.intBetween(80, 120)
  } else {
    variantCount = 3700
  }

  const paddedId = String(idx + 1).padStart(4, '0')
  const limsId = `SIM-${paddedId}`
  const sample: SampleMetadata = {
    lims_id: limsId,
    person_id: 1000 + idx + 1,
    analysis_id: 5000 + idx + 1,
    case_name: `Simulated Case ${limsId}`
  }

  const variants = generateSampleVariants(sample, variantCount, sampleSeed, catalog, sharedPool)
  const generatedFiles: string[] = []
  const gzip = options.gzip ?? true

  for (const fmt of options.formats) {
    let finalPath: string
    let tmpPath: string

    switch (fmt) {
      case 'simple-json': {
        const ext = gzip ? '.json.gz' : '.json'
        finalPath = join(options.outDir, `${limsId}${ext}`)
        tmpPath = `${finalPath}.tmp-${process.pid}-${idx}`
        await writeSimpleJson(sample, variants, { outputPath: tmpPath, gzip })
        renameSync(tmpPath, finalPath)
        generatedFiles.push(finalPath)
        break
      }

      case 'columnar-json': {
        const ext = gzip ? '.columnar.json.gz' : '.columnar.json'
        finalPath = join(options.outDir, `${limsId}${ext}`)
        tmpPath = `${finalPath}.tmp-${process.pid}-${idx}`
        await writeColumnarJson(sample, variants, { outputPath: tmpPath, gzip, wrapped: true })
        renameSync(tmpPath, finalPath)
        generatedFiles.push(finalPath)
        break
      }

      case 'vcf': {
        const ext = gzip ? '.vcf.gz' : '.vcf'
        finalPath = join(options.outDir, `${limsId}${ext}`)
        tmpPath = `${finalPath}.tmp-${process.pid}-${idx}`
        await writeVcf(sample, variants, { outputPath: tmpPath, gzip })
        renameSync(tmpPath, finalPath)
        generatedFiles.push(finalPath)
        break
      }

      case 'xlsx': {
        finalPath = join(options.outDir, `${limsId}.xlsx`)
        tmpPath = `${finalPath}.tmp-${process.pid}-${idx}`
        writeXlsx(sample, variants, { outputPath: tmpPath })
        renameSync(tmpPath, finalPath)
        generatedFiles.push(finalPath)
        break
      }
    }
  }

  return {
    sample,
    variantCount,
    seed: sampleSeed,
    generatedFiles,
    elapsedMs: Date.now() - startTime
  }
}

/**
 * Runs the simulation according to options.
 */
export async function simulateCohort(options: SimulatorOptions): Promise<CohortManifest> {
  const startTime = Date.now()
  const masterSeed = options.seed ?? DEFAULT_MASTER_SEED
  const totalSamples = options.samples
  const outDir = resolve(options.outDir)
  mkdirSync(outDir, { recursive: true })

  let catalog = GeneCatalog.load()
  if (options.geneFilter && options.geneFilter.length > 0) {
    catalog = catalog.filterGenes(options.geneFilter)
  }

  const sharedPoolSeed = deriveSeed(masterSeed, 0, 'shared-pool')
  const sharedPool = createCohortSharedPool(catalog, options, sharedPoolSeed)

  const numWorkers = Math.min(
    options.workers ?? (totalSamples > 4 ? Math.min(availableParallelism(), 8) : 1),
    totalSamples
  )

  const results: GeneratedSampleResult[] = new Array(totalSamples)
  let completedSamples = 0
  let totalVariants = 0

  const reportProgress = (msg?: string): void => {
    const elapsedMs = Math.max(1, Date.now() - startTime)
    const rate = Math.round((totalVariants / elapsedMs) * 1000)
    options.onProgress?.({
      currentSample: completedSamples,
      totalSamples,
      currentVariants: totalVariants,
      totalVariants: 0,
      elapsedMs,
      rateVariantsPerSec: rate,
      statusMessage: msg
    } satisfies SimulatorProgress)
  }

  if (numWorkers <= 1) {
    // Single-thread in-process execution
    for (let idx = 0; idx < totalSamples; idx++) {
      if (options.signal?.aborted === true) {
        throw new Error('Simulation cancelled by abort signal')
      }
      const res = await runSampleInProcess(idx, masterSeed, options, catalog, sharedPool)
      results[idx] = res
      completedSamples++
      totalVariants += res.variantCount
      reportProgress(`Generated ${res.sample.lims_id}`)
    }
  } else {
    // Multi-worker thread execution
    const chunkSize = Math.ceil(totalSamples / numWorkers)
    const workerPromises: Promise<void>[] = []
    const workerPath = resolve(__dirname, 'worker.ts')

    for (let w = 0; w < numWorkers; w++) {
      const startIdx = w * chunkSize
      const endIdx = Math.min(startIdx + chunkSize, totalSamples)
      if (startIdx >= endIdx) continue

      const payload: WorkerPayload = {
        startIdx,
        endIdx,
        masterSeed,
        options
      }

      const p = new Promise<void>((resolvePromise, rejectPromise) => {
        // Spawn worker via tsx loader if in dev/ts mode
        const worker = new Worker(
          `
          const { register } = require('node:module');
          const path = require('node:path');
          require('tsx/cjs');
          require(${JSON.stringify(workerPath)});
          `,
          {
            eval: true,
            workerData: payload
          }
        )

        worker.on('message', (msg: WorkerMessage) => {
          if (msg.type === 'sample-complete' && msg.sampleIndex !== undefined && msg.result) {
            results[msg.sampleIndex] = msg.result
            completedSamples++
            totalVariants += msg.result.variantCount
            reportProgress(`Worker ${w + 1}: ${msg.result.sample.lims_id}`)
          } else if (msg.type === 'done') {
            resolvePromise()
          } else if (msg.type === 'error') {
            rejectPromise(
              new Error(
                msg.error !== undefined && msg.error !== ''
                  ? msg.error
                  : 'Worker encountered an error'
              )
            )
          }
        })

        worker.on('error', (err) => {
          // Fall back to in-process execution if worker eval fails in ts environment
          rejectPromise(err)
        })

        if (options.signal !== undefined) {
          options.signal.addEventListener('abort', () => {
            worker.terminate()
            rejectPromise(new Error('Simulation cancelled by abort signal'))
          })
        }
      }).catch(async () => {
        // Fallback for this worker's chunk: run in-process
        for (let idx = startIdx; idx < endIdx; idx++) {
          if (options.signal?.aborted === true) throw new Error('Simulation cancelled')
          const res = await runSampleInProcess(idx, masterSeed, options, catalog, sharedPool)
          results[idx] = res
          completedSamples++
          totalVariants += res.variantCount
          reportProgress(`Fallback: ${res.sample.lims_id}`)
        }
      })

      workerPromises.push(p)
    }

    await Promise.all(workerPromises)
  }

  // Write cohort manifest and samples.txt
  writeCohortFiles(results, options, masterSeed, outDir)

  const manifest: CohortManifest = {
    generator: 'VarLens-Synthetic-Simulator',
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    masterSeed,
    preset: options.preset || 'custom',
    totalSamples,
    totalVariants,
    formats: options.formats,
    gzipped: options.gzip ?? false,
    samples: results.map((r) => ({
      limsId: r.sample.lims_id,
      personId: r.sample.person_id,
      analysisId: r.sample.analysis_id,
      variantCount: r.variantCount,
      seed: r.seed,
      files: r.generatedFiles
    }))
  }

  return manifest
}
