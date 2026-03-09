import { createReadStream } from 'node:fs'
import { createGunzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { parser } from 'stream-json'
import { pick } from 'stream-json/filters/Pick'
import { streamArray } from 'stream-json/streamers/StreamArray'
import { createFieldMapper } from '../transforms/FieldMapper'
import { createBatchAccumulator } from '../transforms/BatchAccumulator'
import type { ImportOptions, ImportResult, DataDictionaries } from '../types'
import type { ImportStrategy, FormatInfo, StrategyContext } from './ImportStrategy'
import { importRegistry } from './StrategyRegistry'

/**
 * Strategy for columnar format: { "<caseId>": { "header": [...], "data": [[...]] } }
 * Original Varvis API format with dictionaries in header
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

    // Extract gene dictionary from header before processing data
    const dictionaries = await this.extractDictionaries(filePath, formatInfo.caseKey)

    // Create pipeline stages
    const batchSize = options.batchSize ?? 5000
    const fieldMapper = createFieldMapper(dictionaries)
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
        fieldMapper.destroy(new Error('Import cancelled'))
      })
    }

    // Build the pipeline
    await pipeline(
      createReadStream(filePath),
      createGunzip(),
      parser(),
      pick({ filter: `${formatInfo.caseKey}.data` }),
      streamArray(),
      fieldMapper,
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

  /**
   * Extract data dictionaries from JSON header
   */
  private async extractDictionaries(
    filePath: string,
    caseIdKey: string
  ): Promise<DataDictionaries> {
    return new Promise((resolve, reject) => {
      const dictionaries: DataDictionaries = {
        gene: {},
        impact: {},
        transcript: {},
        hpoSimScore: {},
        moi: {}
      }

      const fieldsToExtract = new Set(['Gene', 'Transcript', 'HpoSimScore', 'MoI'])
      let foundCount = 0
      let resolved = false

      const stream = createReadStream(filePath)
        .pipe(createGunzip())
        .pipe(parser())
        .pipe(pick({ filter: `${caseIdKey}.header` }))
        .pipe(streamArray())

      const cleanup = (): void => {
        stream.removeAllListeners()
        stream.destroy()
      }

      const resolveNow = (): void => {
        if (resolved) return
        resolved = true
        cleanup()
        resolve(dictionaries)
      }

      stream.on('data', (data: { key: number; value: Record<string, unknown> }) => {
        if (resolved) return

        const headerItem = data.value
        const fieldId = headerItem.id as string

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

          foundCount++
          if (foundCount >= fieldsToExtract.size) {
            resolveNow()
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
