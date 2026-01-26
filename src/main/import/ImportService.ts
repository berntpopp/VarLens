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
   *
   * Listens for 'keyValue' event from parser which contains the key name in value field
   */
  private async extractCaseId(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const stream = createReadStream(filePath).pipe(createGunzip()).pipe(parser())

      let caseId: string | null = null
      let depth = 0

      stream.on('data', (data: { name?: string; value?: unknown }) => {
        // Track depth
        if (data.name === 'startObject' || data.name === 'startArray') {
          depth++
        } else if (data.name === 'endObject' || data.name === 'endArray') {
          depth--
        }

        // Look for first keyValue at depth 1 (top-level object key)
        if (data.name === 'keyValue' && depth === 1 && caseId === null) {
          caseId = String(data.value)
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
   * Reads the header array and extracts dictionaries for fields that need resolution.
   * Uses pick + streamArray to parse header items.
   */
  private async extractDictionaries(filePath: string): Promise<DataDictionaries> {
    return new Promise((resolve, reject) => {
      const dictionaries: DataDictionaries = {
        gene: {},
        impact: {},
        transcript: {},
        hpoSimScore: {},
        hpoMatch: {},
        moi: {}
      }

      // Track which dictionaries we've found
      const fieldsToExtract = new Set(['Gene', 'Transcript', 'HpoSimScore', 'HpoMatch', 'MoI'])
      let foundCount = 0

      // First, get the case ID so we know the path
      this.extractCaseId(filePath)
        .then((caseId) => {
          const stream = createReadStream(filePath)
            .pipe(createGunzip())
            .pipe(parser())
            .pipe(pick({ filter: `${caseId}.header` }))
            .pipe(streamArray())

          stream.on('data', (data: { key: number; value: Record<string, unknown> }) => {
            const headerItem = data.value
            const fieldId = headerItem.id as string

            if (
              fieldsToExtract.has(fieldId) &&
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
                  // Dictionary maps ID -> score (number)
                  dictionaries.hpoSimScore = rawDict as Record<string, number>
                  break
                case 'HpoMatch':
                  // Dictionary maps ID -> array of HPO terms, join them
                  for (const [key, value] of Object.entries(rawDict)) {
                    if (Array.isArray(value) && value.length > 0) {
                      dictionaries.hpoMatch[key] = value.join(', ')
                    } else {
                      dictionaries.hpoMatch[key] = ''
                    }
                  }
                  break
                case 'MoI':
                  // Dictionary maps ID -> array of objects with abbreviation
                  for (const [key, value] of Object.entries(rawDict)) {
                    if (Array.isArray(value) && value.length > 0) {
                      // Extract abbreviations from objects
                      const abbrevs = value
                        .map((obj: { abbreviation?: string }) => obj.abbreviation)
                        .filter(Boolean)
                      dictionaries.moi[key] = abbrevs.join(', ')
                    } else {
                      dictionaries.moi[key] = ''
                    }
                  }
                  break
              }

              foundCount++
              // Destroy stream once we have all needed dictionaries
              if (foundCount >= fieldsToExtract.size) {
                stream.destroy()
              }
            }
          })

          stream.on('close', () => {
            resolve(dictionaries)
          })

          stream.on('error', reject)
        })
        .catch(reject)
    })
  }
}
