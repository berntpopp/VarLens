import { createReadStream, statSync, existsSync } from 'node:fs'
import { createGunzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { parser } from 'stream-json'
import { pick } from 'stream-json/filters/Pick'
import { streamArray } from 'stream-json/streamers/StreamArray'
import { DatabaseService } from '../database/DatabaseService'
import { createFieldMapper } from './transforms/FieldMapper'
import { createObjectFormatMapper } from './transforms/ObjectFormatMapper'
import { createBatchAccumulator } from './transforms/BatchAccumulator'
import type { ImportOptions, ImportResult, DataDictionaries } from './types'

/**
 * Detected file format types
 */
type FileFormat = 'columnar' | 'object'

/**
 * Format detection result
 */
interface FormatInfo {
  format: FileFormat
  /** For columnar: the case ID key. For object: the first sample ID */
  caseKey: string
}

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
   * Automatically detects file format:
   * - Columnar format: { "<caseId>": { "header": [...], "data": [[...], ...] } }
   * - Object format: { "metadata": {...}, "samples": { "<sampleId>": { "variants": [...] } } }
   *
   * @param filePath - Path to .json.gz file
   * @param options - Import options including case name and callbacks
   * @returns Import result with case ID and statistics
   * @throws Error if file doesn't exist, case name is duplicate, or import fails
   */
  async importVariants(filePath: string, options: ImportOptions): Promise<ImportResult> {
    const startTime = Date.now()
    const caseId: number | null = null

    // Fail fast if file doesn't exist
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`)
    }

    try {
      // Detect file format
      const formatInfo = await this.detectFormat(filePath)

      // Route to appropriate parser
      if (formatInfo.format === 'object') {
        return await this.importObjectFormat(filePath, options, formatInfo, startTime)
      }

      // Default: columnar format
      return await this.importColumnarFormat(filePath, options, formatInfo.caseKey, startTime)
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
   * Import variants from columnar format (original Varvis API format)
   */
  private async importColumnarFormat(
    filePath: string,
    options: ImportOptions,
    caseIdKey: string,
    startTime: number
  ): Promise<ImportResult> {
    let caseId: number | null = null

    try {
      // Get file size for case metadata
      const fileStats = statSync(filePath)
      const fileSize = fileStats.size

      // Extract gene dictionary from header before processing data
      const dictionaries = await this.extractDictionaries(filePath, caseIdKey)

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
      if (options.signal !== undefined) {
        options.signal.addEventListener('abort', () => {
          fieldMapper.destroy(new Error('Import cancelled'))
        })
      }

      // Build the pipeline
      // Structure: { "caseId": { "header": [...], "data": [[...], ...] } }
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
          console.error('Failed to rollback case creation:', rollbackError)
        }
      }
      throw error
    }
  }

  /**
   * Import variants from object format (new export script format)
   *
   * Structure: { "metadata": {...}, "samples": { "<sampleId>": { "variants": [...] } } }
   */
  private async importObjectFormat(
    filePath: string,
    options: ImportOptions,
    formatInfo: FormatInfo,
    startTime: number
  ): Promise<ImportResult> {
    let caseId: number | null = null

    try {
      // Get file size for case metadata
      const fileStats = statSync(filePath)
      const fileSize = fileStats.size

      // Create case record
      caseId = this.db.createCase(options.caseName, filePath, fileSize)

      // Create pipeline stages
      const batchSize = options.batchSize ?? this.defaultBatchSize
      const objectMapper = createObjectFormatMapper()
      const batchAccumulator = createBatchAccumulator({
        caseId,
        batchSize,
        db: this.db,
        onProgress: options.onProgress,
        startTime
      })

      // Handle cancellation
      if (options.signal !== undefined) {
        options.signal.addEventListener('abort', () => {
          objectMapper.destroy(new Error('Import cancelled'))
        })
      }

      // Build the pipeline for object format
      // Structure: { "metadata": {...}, "samples": { "<sampleId>": { "variants": [...] } } }
      await pipeline(
        createReadStream(filePath),
        createGunzip(),
        parser(),
        pick({ filter: `samples.${formatInfo.caseKey}.variants` }),
        streamArray(),
        objectMapper,
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
          console.error('Failed to rollback case creation:', rollbackError)
        }
      }
      throw error
    }
  }

  /**
   * Detect the file format by examining top-level keys
   *
   * Returns format type and the relevant case key:
   * - Columnar: first top-level key is the case ID
   * - Object: has 'metadata' and 'samples' keys, extracts first sample ID
   */
  private async detectFormat(filePath: string): Promise<FormatInfo> {
    return new Promise((resolve, reject) => {
      const stream = createReadStream(filePath).pipe(createGunzip()).pipe(parser())

      const topLevelKeys: string[] = []
      let depth = 0
      let resolved = false

      const cleanup = (): void => {
        stream.removeAllListeners()
        stream.destroy()
      }

      const resolveFormat = (format: FileFormat, caseKey: string): void => {
        if (resolved) return
        resolved = true
        cleanup()
        resolve({ format, caseKey })
      }

      const rejectFormat = (error: Error): void => {
        if (resolved) return
        resolved = true
        cleanup()
        reject(error)
      }

      stream.on('data', (data: { name?: string; value?: unknown }) => {
        if (resolved) return

        // Track depth
        if (data.name === 'startObject' || data.name === 'startArray') {
          depth++
        } else if (data.name === 'endObject' || data.name === 'endArray') {
          depth--
        }

        // Collect top-level keys
        if (data.name === 'keyValue' && depth === 1) {
          topLevelKeys.push(String(data.value))

          // Check for object format markers
          if (topLevelKeys.includes('metadata') && topLevelKeys.includes('samples')) {
            // Object format - need to extract sample ID
            resolved = true
            cleanup()
            this.extractFirstSampleId(filePath)
              .then((sampleId) => {
                resolve({ format: 'object', caseKey: sampleId })
              })
              .catch(reject)
            return
          }

          // If first key is neither 'metadata' nor 'samples', it's columnar format
          if (
            topLevelKeys.length === 1 &&
            topLevelKeys[0] !== 'metadata' &&
            topLevelKeys[0] !== 'samples'
          ) {
            resolveFormat('columnar', topLevelKeys[0])
            return
          }
        }
      })

      stream.on('end', () => {
        if (resolved) return

        if (topLevelKeys.length === 0) {
          rejectFormat(new Error('Could not detect file format: no top-level keys found'))
          return
        }

        // Determine format based on collected keys
        if (topLevelKeys.includes('metadata') || topLevelKeys.includes('samples')) {
          // Object format - need to extract sample ID
          resolved = true
          this.extractFirstSampleId(filePath)
            .then((sampleId) => {
              resolve({ format: 'object', caseKey: sampleId })
            })
            .catch(reject)
        } else {
          resolveFormat('columnar', topLevelKeys[0])
        }
      })

      stream.on('error', rejectFormat)
    })
  }

  /**
   * Extract the first sample ID from object format file
   */
  private async extractFirstSampleId(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const stream = createReadStream(filePath).pipe(createGunzip()).pipe(parser())

      let inSamples = false
      let sampleId: string | null = null
      let depth = 0
      let resolved = false

      const cleanup = (): void => {
        stream.removeAllListeners()
        stream.destroy()
      }

      stream.on('data', (data: { name?: string; value?: unknown }) => {
        if (resolved) return

        // Track depth
        if (data.name === 'startObject' || data.name === 'startArray') {
          depth++
        } else if (data.name === 'endObject' || data.name === 'endArray') {
          depth--
        }

        // Look for 'samples' key at depth 1
        if (data.name === 'keyValue' && depth === 1 && data.value === 'samples') {
          inSamples = true
        }

        // Look for first key inside 'samples' (depth 2)
        if (inSamples && data.name === 'keyValue' && depth === 2 && sampleId === null) {
          sampleId = String(data.value)
          resolved = true
          cleanup()
          resolve(sampleId)
        }
      })

      stream.on('end', () => {
        if (resolved) return
        resolved = true
        cleanup()
        if (sampleId !== null) {
          resolve(sampleId)
        } else {
          reject(new Error('Could not extract sample ID from object format JSON'))
        }
      })

      stream.on('error', (err) => {
        if (resolved) return
        resolved = true
        cleanup()
        reject(err)
      })
    })
  }

  /**
   * Extract data dictionaries from JSON header (columnar format only)
   *
   * Reads the header array and extracts dictionaries for fields that need resolution.
   * Uses pick + streamArray to parse header items.
   *
   * @param filePath - Path to the JSON file
   * @param caseIdKey - The case ID key (top-level key in columnar format)
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

      // Track which dictionaries we've found
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
              // Dictionary maps ID -> score (number)
              dictionaries.hpoSimScore = rawDict as Record<string, number>
              break
            case 'MoI':
              // Dictionary maps ID -> array of objects with abbreviation
              for (const [key, value] of Object.entries(rawDict)) {
                const isArray: boolean = Array.isArray(value)
                if (isArray && (value as unknown[]).length > 0) {
                  // Extract abbreviations from objects
                  const abbrevs = (value as { abbreviation?: string }[])
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
          // Resolve immediately once we have all needed dictionaries
          if (foundCount >= fieldsToExtract.size) {
            resolveNow()
          }
        }
      })

      stream.on('end', () => {
        // Resolve with whatever we found (some dictionaries may not exist in file)
        resolveNow()
      })

      stream.on('error', (err) => {
        if (resolved) return
        resolved = true
        cleanup()
        reject(err)
      })
    })
  }
}
