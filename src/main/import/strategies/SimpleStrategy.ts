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
 * Strategy for simple format: { "person_id": ..., "variants": [...] }
 * Direct top-level variants array
 */
export class SimpleStrategy implements ImportStrategy {
  readonly formatId = 'simple' as const

  canHandle(formatInfo: FormatInfo): boolean {
    return formatInfo.format === 'simple'
  }

  async import(
    filePath: string,
    options: ImportOptions,
    context: StrategyContext
  ): Promise<ImportResult> {
    const { db, caseId, startTime } = context

    // Create pipeline stages
    const batchSize = options.batchSize ?? 5000
    const objectMapper = createObjectFormatMapper()
    const batchAccumulator = createBatchAccumulator({
      caseId,
      batchSize,
      flushFn: (cId, batch) => db.variants.insertVariantsBatch(cId, batch),
      onProgress: options.onProgress,
      startTime
    })

    // Handle cancellation
    if (options.signal !== undefined) {
      options.signal.addEventListener('abort', () => {
        objectMapper.destroy(new Error('Import cancelled'))
      })
    }

    // Build the pipeline for simple format
    await pipeline(
      createDecompressedStream(filePath),
      parser.asStream(),
      pick.asStream({ filter: 'variants' }),
      streamArray.asStream(),
      objectMapper,
      batchAccumulator
    )

    // Get final statistics
    const variantCount = batchAccumulator.inserted
    const skipped = batchAccumulator.skippedCount
    const elapsed = Date.now() - startTime

    // Update case with final variant count
    db.cases.updateCaseVariantCount(caseId, variantCount)

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
importRegistry.register(new SimpleStrategy())
