import { DatabaseService } from '../database/DatabaseService'
import { ImportService } from './ImportService'
import { NotFoundError } from '../database/errors'
import type { BatchImportOptions } from './types'

export interface BatchFileDetail {
  filePath: string
  fileName: string
  status: 'pending' | 'importing' | 'success' | 'failed' | 'skipped'
  caseName?: string
  variantCount?: number
  error?: string
}

export interface BatchResult {
  succeeded: number
  failed: number
  skipped: number
  cancelled: boolean
  details: BatchFileDetail[]
}

export interface DuplicateCheckItem {
  filePath: string
  fileName: string
  caseName: string
  isDuplicate: boolean
}

/**
 * BatchImportService - Orchestrates sequential import of multiple variant files
 *
 * Duplicate checking happens upfront via checkDuplicates(), before any import starts.
 * The import loop applies the pre-determined strategy without mid-import prompts.
 */
export class BatchImportService {
  private db: DatabaseService
  private importService: ImportService

  constructor(db: DatabaseService, importService: ImportService) {
    this.db = db
    this.importService = importService
  }

  /**
   * Check which files have duplicate case names in the database.
   * Call this BEFORE processBatch() so the user can review and choose a strategy.
   */
  checkDuplicates(filePaths: string[]): { files: DuplicateCheckItem[]; duplicateCount: number } {
    const files: DuplicateCheckItem[] = []
    let duplicateCount = 0

    for (const filePath of filePaths) {
      const fileName = this.extractFileName(filePath)
      const caseName = this.extractCaseName(fileName)

      let isDuplicate = false
      try {
        this.db.getCaseByName(caseName)
        isDuplicate = true
        duplicateCount++
      } catch (error) {
        if (!(error instanceof NotFoundError)) {
          throw error
        }
      }

      files.push({ filePath, fileName, caseName, isDuplicate })
    }

    return { files, duplicateCount }
  }

  /**
   * Process multiple files sequentially with a pre-determined duplicate strategy.
   */
  async processBatch(filePaths: string[], options: BatchImportOptions): Promise<BatchResult> {
    const result: BatchResult = {
      succeeded: 0,
      failed: 0,
      skipped: 0,
      cancelled: false,
      details: []
    }

    // Track case names imported in this batch to detect in-batch duplicates
    const importedInBatch = new Set<string>()

    for (let i = 0; i < filePaths.length; i++) {
      // Check for cancellation before processing each file
      if (options.signal?.aborted === true) {
        result.cancelled = true
        for (let j = i; j < filePaths.length; j++) {
          const fileName = this.extractFileName(filePaths[j])
          result.details.push({
            filePath: filePaths[j],
            fileName,
            status: 'skipped',
            error: 'Cancelled by user'
          })
          result.skipped++
        }
        break
      }

      const filePath = filePaths[i]
      const fileName = this.extractFileName(filePath)
      const caseName = this.extractCaseName(fileName)

      // Emit batch progress
      const overallPercent = Math.round((i / filePaths.length) * 100)
      options.onBatchProgress?.({
        currentIndex: i,
        totalFiles: filePaths.length,
        fileName,
        overallPercent
      })

      const fileDetail: BatchFileDetail = {
        filePath,
        fileName,
        status: 'importing',
        caseName
      }

      try {
        // Check for duplicate in database
        let existingCaseId: number | null = null
        let isDuplicate = false

        try {
          const existingCase = this.db.getCaseByName(caseName)
          isDuplicate = true
          existingCaseId = existingCase.id
        } catch (error) {
          if (!(error instanceof NotFoundError)) {
            throw error
          }
        }

        // Also check in-batch duplicates
        if (importedInBatch.has(caseName) === true) {
          isDuplicate = true
        }

        // Apply pre-determined strategy
        if (isDuplicate === true) {
          if (options.duplicateStrategy === 'skip') {
            fileDetail.status = 'skipped'
            fileDetail.error = 'Duplicate case name'
            result.details.push(fileDetail)
            result.skipped++
            continue
          } else if (options.duplicateStrategy === 'overwrite' && existingCaseId !== null) {
            this.db.deleteCase(existingCaseId)
            importedInBatch.delete(caseName)
          }
        }

        // Import the file
        const importResult = await this.importService.importVariants(filePath, {
          caseName,
          onProgress: options.onFileProgress,
          signal: options.signal
        })

        fileDetail.status = 'success'
        fileDetail.variantCount = importResult.variantCount
        result.details.push(fileDetail)
        result.succeeded++
        importedInBatch.add(caseName)
      } catch (error) {
        fileDetail.status = 'failed'
        fileDetail.error = error instanceof Error ? error.message : 'Unknown error during import'
        result.details.push(fileDetail)
        result.failed++
      }
    }

    return result
  }

  /**
   * Extract file name from path
   */
  private extractFileName(filePath: string): string {
    const parts = filePath.split('/')
    const lastPart = parts[parts.length - 1]
    if (lastPart !== undefined && lastPart !== '') {
      return lastPart
    }
    const backslashParts = filePath.split('\\')
    return backslashParts[backslashParts.length - 1] ?? 'unknown'
  }

  /**
   * Extract case name from file name (strip .gz and .json extensions)
   */
  private extractCaseName(fileName: string): string {
    let name = fileName
    if (name.endsWith('.gz') === true) {
      name = name.slice(0, -3)
    }
    if (name.endsWith('.json') === true) {
      name = name.slice(0, -5)
    }
    return name
  }
}
