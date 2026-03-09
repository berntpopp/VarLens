import { statSync, existsSync } from 'node:fs'
import { createReadStream } from 'node:fs'
import { createGunzip } from 'node:zlib'
import { parser } from 'stream-json'
import { DatabaseService } from '../database/DatabaseService'
import { mainLogger } from '../services/MainLogger'
import type { ImportOptions, ImportResult } from './types'
import { importRegistry } from './strategies'
import type { FormatInfo, StrategyContext, FileFormat } from './strategies'

// Import strategies to ensure they are registered
import './strategies'

/**
 * ImportService - Facade for variant import using strategy pattern
 *
 * Detects file format and delegates to appropriate strategy:
 * - Columnar: { "<caseId>": { "header": [...], "data": [[...]] } }
 * - Object: { "metadata": {...}, "samples": { "<sampleId>": { "variants": [...] } } }
 * - Simple: { "variants": [...] } - direct variants array
 */
export class ImportService {
  private db: DatabaseService

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

    // Fail fast if file doesn't exist
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`)
    }

    try {
      // Detect file format
      const formatInfo = await this.detectFormat(filePath)

      // Get file size for case metadata
      const fileStats = statSync(filePath)
      const fileSize = fileStats.size

      // Create case record (before strategy runs)
      caseId = this.db.cases.createCase(options.caseName, filePath, fileSize)

      // Get strategy from registry
      const strategy = importRegistry.getStrategy(formatInfo)

      // Build strategy context
      const context: StrategyContext = {
        db: this.db,
        formatInfo,
        caseId,
        startTime
      }

      // Execute import via strategy
      const result = await strategy.import(filePath, options, context)

      // Auto-populate data info with import provenance
      try {
        const parts = filePath.split(/[/\\]/)
        const fileName = parts[parts.length - 1] || filePath
        this.db.metadata.upsertCaseDataInfo(caseId, {
          import_file_name: fileName,
          import_file_type: formatInfo.format
        })
      } catch (infoError) {
        mainLogger.warn(`Failed to save data info: ${infoError}`, 'import')
      }

      return result
    } catch (error) {
      // Rollback case creation on failure
      if (caseId !== null) {
        try {
          this.db.cases.deleteCase(caseId)
        } catch (rollbackError) {
          mainLogger.error(`Failed to rollback case creation: ${rollbackError}`, 'import')
        }
      }

      throw error instanceof Error ? error : new Error(String(error))
    }
  }

  /**
   * Detect the file format by examining top-level keys
   *
   * Returns format type and the relevant case key:
   * - Columnar: first top-level key is the case ID
   * - Object: has 'metadata' and 'samples' keys, extracts first sample ID
   * - Simple: has 'variants' key at top level
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

          // Check for simple format
          if (topLevelKeys.includes('variants')) {
            resolveFormat('simple', 'variants')
            return
          }

          // Check for object format markers
          if (topLevelKeys.includes('metadata') && topLevelKeys.includes('samples')) {
            resolved = true
            cleanup()
            this.extractFirstSampleId(filePath)
              .then((sampleId) => {
                resolve({ format: 'object', caseKey: sampleId })
              })
              .catch(reject)
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

        if (topLevelKeys.includes('variants')) {
          resolveFormat('simple', 'variants')
        } else if (topLevelKeys.includes('metadata') || topLevelKeys.includes('samples')) {
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

        if (data.name === 'startObject' || data.name === 'startArray') {
          depth++
        } else if (data.name === 'endObject' || data.name === 'endArray') {
          depth--
        }

        if (data.name === 'keyValue' && depth === 1 && data.value === 'samples') {
          inSamples = true
        }

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
}
