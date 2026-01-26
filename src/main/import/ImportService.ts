import { createReadStream, statSync } from 'node:fs'
import { createGunzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { parser } from 'stream-json'
import { pick } from 'stream-json/filters/Pick'
import { streamArray } from 'stream-json/streamers/StreamArray'
import { DatabaseService } from '../database/DatabaseService'
import { createFieldMapper } from './transforms/FieldMapper'
import { createBatchAccumulator } from './transforms/BatchAccumulator'
import type { ImportOptions, ImportResult, DataDictionaries } from './types'

/**
 * ImportService - Streams large gzipped JSON files through a pipeline of
 * decompression, parsing, field mapping, and batch database insertion.
 *
 * Pipeline stages:
 * 1. createReadStream - Read file in chunks
 * 2. createGunzip - Decompress gzip stream
 * 3. parser - Parse JSON stream
 * 4. pick('data') - Extract data array from JSON
 * 5. streamArray - Stream array elements
 * 6. FieldMapper - Map raw rows to Variant objects
 * 7. BatchAccumulator - Batch and insert into database
 */
export class ImportService {
  private db: DatabaseService
  private readonly defaultBatchSize = 5000

  constructor(db: DatabaseService) {
    this.db = db
  }

  /**
   * Import variants from a gzipped JSON file
   *
   * @param filePath - Path to .json.gz file
   * @param options - Import options including case name and callbacks
   * @returns Import result with case ID and statistics
   * @throws Error if file doesn't exist, case name is duplicate, or import fails
   */
  async importVariants(filePath: string, options: ImportOptions): Promise<ImportResult> {
    const startTime = Date.now()
    let caseId: number | null = null

    try {
      // Get file size for case metadata
      const fileStats = statSync(filePath)
      const fileSize = fileStats.size

      // Extract gene dictionary from header before processing data
      const dictionaries = await this.extractDictionaries(filePath)

      // Create case record
      caseId = this.db.createCase(options.caseName, filePath, fileSize)

      // Create pipeline stages
      const batchSize = options.batchSize ?? this.defaultBatchSize
      const fieldMapper = createFieldMapper(dictionaries)
      const batchAccumulator = createBatchAccumulator({
        caseId,
        batchSize,
        db: this.db,
        onProgress: options.onProgress,
        startTime
      })

      // Handle cancellation
      if (options.signal) {
        options.signal.addEventListener('abort', () => {
          fieldMapper.destroy(new Error('Import cancelled'))
        })
      }

      // Build the pipeline
      // Structure: { "caseId": { "header": [...], "data": [[...], ...] } }
      // We use pick to extract the first key's "data" property
      const caseIdKey = await this.extractCaseId(filePath)

      await pipeline(
        createReadStream(filePath),
        createGunzip(),
        parser(),
        pick({ filter: `${caseIdKey}.data` }),
        streamArray(),
        fieldMapper,
        batchAccumulator
      )

      // Get final statistics
      const variantCount = batchAccumulator.inserted
      const skipped = batchAccumulator.skippedCount
      const elapsed = Date.now() - startTime

      // Update case with final variant count
      this.db.updateCaseVariantCount(caseId, variantCount)

      return {
        caseId,
        variantCount,
        skipped,
        errors: [],
        elapsed
      }
    } catch (error) {
      // Rollback case creation on failure
      if (caseId !== null) {
        try {
          this.db.deleteCase(caseId)
        } catch (rollbackError) {
          // Log but don't throw - original error is more important
          console.error('Failed to rollback case creation:', rollbackError)
        }
      }

      throw error instanceof Error ? error : new Error(String(error))
    }
  }

  /**
   * Extract the case ID (top-level key) from JSON file
   */
  private async extractCaseId(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const stream = createReadStream(filePath).pipe(createGunzip()).pipe(parser())

      let caseId: string | null = null

      stream.on('data', (data: { name?: string; value?: unknown }) => {
        // Look for the first top-level key
        if (
          data.name !== undefined &&
          data.name !== '' &&
          caseId === null &&
          !data.name.includes('.')
        ) {
          caseId = data.name
          stream.destroy() // Stop reading once we have the case ID
        }
      })

      stream.on('close', () => {
        if (caseId !== null) {
          resolve(caseId)
        } else {
          reject(new Error('Could not extract case ID from JSON'))
        }
      })

      stream.on('error', reject)
    })
  }

  /**
   * Extract data dictionaries from JSON header
   *
   * Reads the header array to find fields with dataDictionary properties.
   * Currently extracts Gene dictionary (ID -> symbol mapping).
   */
  private async extractDictionaries(filePath: string): Promise<DataDictionaries> {
    return new Promise((resolve, reject) => {
      const stream = createReadStream(filePath).pipe(createGunzip()).pipe(parser())

      const dictionaries: DataDictionaries = {
        gene: {},
        impact: {}
      }

      let headerPath = ''
      let currentHeaderItem: Record<string, unknown> = {}
      let inHeaderItem = false

      stream.on('data', (data: { name?: string; value?: unknown }) => {
        if (data.name === undefined) return

        // Track when we're in a header item
        if (data.name.match(/^\d+\.header\.\d+$/) !== null) {
          inHeaderItem = true
          headerPath = data.name
          currentHeaderItem = {}
        }

        // Collect header item properties
        if (inHeaderItem && data.name.startsWith(headerPath)) {
          const propName = data.name.substring(headerPath.length + 1)
          if (!propName.includes('.')) {
            currentHeaderItem[propName] = data.value
          }
        }

        // When we finish a header item, check if it's Gene field
        if (
          inHeaderItem &&
          currentHeaderItem.id === 'Gene' &&
          currentHeaderItem.dataDictionary !== undefined &&
          currentHeaderItem.dataDictionary !== null
        ) {
          dictionaries.gene = currentHeaderItem.dataDictionary as Record<string, string>
          stream.destroy() // We have what we need
        }

        // Check if we've moved past the header
        if (data.name.match(/^\d+\.data$/) !== null) {
          stream.destroy() // Stop reading - we're past the header
        }
      })

      stream.on('close', () => {
        resolve(dictionaries)
      })

      stream.on('error', reject)
    })
  }
}
