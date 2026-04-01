import { pipeline } from 'node:stream/promises'
import { parser } from 'stream-json'
import { pick } from 'stream-json/filters/Pick'
import { streamArray } from 'stream-json/streamers/StreamArray'
import { createFieldMapper } from '../transforms/FieldMapper'
import { createBatchAccumulator } from '../transforms/BatchAccumulator'
import { resolveColumnIndices, type ColumnIndices } from '../config/fieldMapping'
import type { ImportOptions, ImportResult, DataDictionaries } from '../types'
import type { ImportStrategy, FormatInfo, StrategyContext } from './ImportStrategy'
import { importRegistry } from './StrategyRegistry'
import { createDecompressedStream } from '../stream-utils'

/** Result of parsing the header: dictionaries + dynamic column positions */
interface HeaderInfo {
  dictionaries: DataDictionaries
  columnIndices: ColumnIndices
}

/**
 * Strategy for columnar format:
 * - Wrapped:   { "<caseId>": { "header": [...], "data": [[...]] } }
 * - Unwrapped: { "header": [...], "data": [[...]] }
 *
 * Column positions are resolved dynamically from the header field IDs,
 * so this works across different VarVis export versions.
 */
export class ColumnarStrategy implements ImportStrategy {
  readonly formatId = 'columnar' as const

  canHandle(formatInfo: FormatInfo): boolean {
    return formatInfo.format === 'columnar'
  }

  async import(
    filePath: string,
    options: ImportOptions,
    context: StrategyContext
  ): Promise<ImportResult> {
    const { db, formatInfo, caseId, startTime } = context

    const wrapped = formatInfo.wrapped !== false

    // Pick paths differ: wrapped = "caseKey.header" / "caseKey.data", unwrapped = "header" / "data"
    const headerPath = wrapped ? `${formatInfo.caseKey}.header` : 'header'
    const dataPath = wrapped ? `${formatInfo.caseKey}.data` : 'data'

    // Extract dictionaries and column positions from header
    const { dictionaries, columnIndices } = await this.parseHeader(filePath, headerPath)

    // Create pipeline stages
    const batchSize = options.batchSize ?? 5000
    const fieldMapper = createFieldMapper(dictionaries, columnIndices)
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
        fieldMapper.destroy(new Error('Import cancelled'))
      })
    }

    // Drop FTS triggers for bulk insert performance
    db.variants.beginBulkInsert()

    try {
      // Build the pipeline
      await pipeline(
        createDecompressedStream(filePath),
        parser(),
        pick({ filter: dataPath }),
        streamArray(),
        fieldMapper,
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

  /**
   * Parse header to extract data dictionaries and dynamic column indices.
   */
  private async parseHeader(filePath: string, headerPath: string): Promise<HeaderInfo> {
    return new Promise((resolve, reject) => {
      const dictionaries: DataDictionaries = {
        gene: {},
        impact: {},
        transcript: {},
        hpoSimScore: {},
        moi: {}
      }

      // Collect all header items to build column index map
      const headerItems: { id: string }[] = []

      const fieldsToExtract = new Set(['Gene', 'Transcript', 'HpoSimScore', 'MoI'])
      let resolved = false

      const stream = createDecompressedStream(filePath)
        .pipe(parser())
        .pipe(pick({ filter: headerPath }))
        .pipe(streamArray())

      const cleanup = (): void => {
        stream.removeAllListeners()
        stream.destroy()
      }

      const resolveNow = (): void => {
        if (resolved) return
        resolved = true
        cleanup()
        resolve({
          dictionaries,
          columnIndices: resolveColumnIndices(headerItems)
        })
      }

      stream.on('data', (data: { key: number; value: Record<string, unknown> }) => {
        if (resolved) return

        const headerItem = data.value
        const fieldId = headerItem.id as string

        // Track header item for column index resolution
        headerItems[data.key] = { id: fieldId }

        const hasField: boolean = fieldsToExtract.has(fieldId)
        if (
          hasField &&
          headerItem.dataDictionary !== undefined &&
          headerItem.dataDictionary !== null
        ) {
          const rawDict = headerItem.dataDictionary as Record<string, unknown>

          switch (fieldId) {
            case 'Gene':
              dictionaries.gene = rawDict as Record<string, string>
              break
            case 'Transcript':
              dictionaries.transcript = rawDict as Record<string, string>
              break
            case 'HpoSimScore':
              dictionaries.hpoSimScore = rawDict as Record<string, number>
              break
            case 'MoI':
              for (const [key, value] of Object.entries(rawDict)) {
                const isArray: boolean = Array.isArray(value)
                if (isArray && (value as unknown[]).length > 0) {
                  const abbrevs = (value as { abbreviation?: string }[])
                    .map((obj) => obj.abbreviation)
                    .filter(Boolean)
                  dictionaries.moi[key] = abbrevs.join(', ')
                } else {
                  dictionaries.moi[key] = ''
                }
              }
              break
          }
        }
      })

      stream.on('end', resolveNow)
      stream.on('error', (err) => {
        if (resolved) return
        resolved = true
        cleanup()
        reject(err)
      })
    })
  }
}

// Self-register on import
importRegistry.register(new ColumnarStrategy())
