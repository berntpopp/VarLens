import { createReadStream } from 'node:fs'
import { createGunzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { parser } from 'stream-json'
import { pick } from 'stream-json/filters/Pick'
import { streamArray } from 'stream-json/streamers/StreamArray'
import { createObjectFormatMapper } from '../transforms/ObjectFormatMapper'
import { createBatchAccumulator } from '../transforms/BatchAccumulator'
import type { ImportOptions, ImportResult } from '../types'
import type { ImportStrategy, FormatInfo, StrategyContext } from './ImportStrategy'
import { importRegistry } from './StrategyRegistry'

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
      db,
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
      createReadStream(filePath),
      createGunzip(),
      parser(),
      pick({ filter: 'variants' }),
      streamArray(),
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
