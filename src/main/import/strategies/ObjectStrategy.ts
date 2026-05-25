import { pipeline } from 'node:stream/promises'
import { parser } from 'stream-json'
import { pick } from 'stream-json/filters/pick.js'
import { streamArray } from 'stream-json/streamers/stream-array.js'
import { createObjectFormatMapper } from '../transforms/ObjectFormatMapper'
import { createBatchAccumulator } from '../transforms/BatchAccumulator'
import type { ImportOptions, ImportResult } from '../types'
import type { ImportStrategy, FormatInfo, StrategyContext } from './ImportStrategy'
import { importRegistry } from './StrategyRegistry'
import { createDecompressedStream } from '../stream-utils'

/**
 * Strategy for object format: { "metadata": {...}, "samples": { "<sampleId>": { "variants": [...] } } }
 * New export script format with nested structure
 */
export class ObjectStrategy implements ImportStrategy {
  readonly formatId = 'object' as const

  canHandle(formatInfo: FormatInfo): boolean {
    return formatInfo.format === 'object'
  }

  async import(
    filePath: string,
    options: ImportOptions,
    context: StrategyContext
  ): Promise<ImportResult> {
    const { db, formatInfo, caseId, startTime } = context

    // Create pipeline stages
    const batchSize = options.batchSize ?? 5000
    const objectMapper = createObjectFormatMapper()
    const batchAccumulator = createBatchAccumulator({
      caseId,
      batchSize,
      flushFn: (cId, batch) => db.variants.insertBatch(batch, cId),
      onProgress: options.onProgress,
      startTime
    })

    // Handle cancellation
    if (options.signal !== undefined) {
      options.signal.addEventListener('abort', () => {
        objectMapper.destroy(new Error('Import cancelled'))
      })
    }

    // Drop FTS triggers for bulk insert performance
    db.variants.beginBulkInsert()

    try {
      // Build the pipeline for object format
      await pipeline(
        createDecompressedStream(filePath),
        parser.asStream(),
        pick.asStream({ filter: `samples.${formatInfo.caseKey}.variants` }),
        streamArray.asStream(),
        objectMapper,
        batchAccumulator
      )
    } finally {
      // Always restore FTS triggers and update case
      db.variants.finishBulkInsert(caseId, batchAccumulator.inserted)
    }

    // Get final statistics
    const variantCount = batchAccumulator.inserted
    const skipped = batchAccumulator.skippedCount
    const elapsed = Date.now() - startTime

    return {
      caseId,
      variantCount,
      skipped,
      errors: [],
      elapsed
    }
  }
}

// Self-register on import
importRegistry.register(new ObjectStrategy())
