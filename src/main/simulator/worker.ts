/**
 * Background worker thread for parallel sample generation.
 */
import { parentPort, workerData } from 'node:worker_threads'
import { join } from 'node:path'
import { renameSync } from 'node:fs'
import { GeneCatalog } from './catalog'
import { deriveSeed, DeterministicRandom } from './random'
import { createSharedVariantPool, generateSampleVariants } from './generator'
import { writeSimpleJson } from './writers/simple-json-writer'
import { writeColumnarJson } from './writers/columnar-json-writer'
import { writeVcf } from './writers/vcf-writer'
import { writeXlsx } from './writers/xlsx-writer'
import type {
  CanonicalVariant,
  GeneratedSampleResult,
  SampleMetadata,
  SimulatorOptions
} from './types'

export interface WorkerPayload {
  startIdx: number
  endIdx: number
  masterSeed: number
  options: SimulatorOptions
}

export interface WorkerMessage {
  type: 'progress' | 'sample-complete' | 'done' | 'error'
  sampleIndex?: number
  result?: GeneratedSampleResult
  error?: string
}

async function processSample(
  idx: number,
  masterSeed: number,
  options: SimulatorOptions,
  catalog: GeneCatalog,
  sharedPool: CanonicalVariant[]
): Promise<GeneratedSampleResult> {
  const startTime = Date.now()
  const sampleSeed = deriveSeed(masterSeed, idx, 'sample')
  const rng = new DeterministicRandom(sampleSeed)

  // Determine variant count
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

  // Synthesize sample metadata
  const paddedId = String(idx + 1).padStart(4, '0')
  const limsId = `SIM-${paddedId}`
  const sample: SampleMetadata = {
    lims_id: limsId,
    person_id: 1000 + idx + 1,
    analysis_id: 5000 + idx + 1,
    case_name: `Simulated Case ${limsId}`
  }

  // Generate canonical variants
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

async function runWorker(): Promise<void> {
  if (!parentPort) return

  try {
    const payload = workerData as WorkerPayload
    const { startIdx, endIdx, masterSeed, options } = payload

    let catalog = GeneCatalog.load()
    if (options.geneFilter && options.geneFilter.length > 0) {
      catalog = catalog.filterGenes(options.geneFilter)
    }

    const poolSeed = deriveSeed(masterSeed, 0, 'shared-pool')
    const sharedPool = createSharedVariantPool(catalog, 500, poolSeed)

    for (let idx = startIdx; idx < endIdx; idx++) {
      const result = await processSample(idx, masterSeed, options, catalog, sharedPool)
      parentPort.postMessage({
        type: 'sample-complete',
        sampleIndex: idx,
        result
      } satisfies WorkerMessage)
    }

    parentPort.postMessage({ type: 'done' } satisfies WorkerMessage)
  } catch (err) {
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err)
    parentPort?.postMessage({ type: 'error', error: message } satisfies WorkerMessage)
  }
}

if (parentPort) {
  runWorker().catch((err) => {
    parentPort?.postMessage({ type: 'error', error: String(err) })
  })
}
