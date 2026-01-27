import { DatabaseService } from '../database/DatabaseService'
import { ImportService } from './ImportService'
import { NotFoundError } from '../database/errors'
import type { BatchImportOptions, DuplicateChoice } from './types'

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

/**
 * BatchImportService - Orchestrates sequential import of multiple variant files
 *
 * Processes files one-by-one with error isolation, duplicate detection, and progress reporting.
 * Errors in individual files do not stop the batch - they're recorded and processing continues.
 */
export class BatchImportService {
  private db: DatabaseService
  private importService: ImportService

  constructor(db: DatabaseService, importService: ImportService) {
    this.db = db
    this.importService = importService
  }

  /**
   * Process multiple files sequentially
   *
   * @param filePaths - Array of file paths to import
   * @param options - Batch import options with callbacks and cancellation signal
   * @returns Batch result with counts and per-file details
   */
  async processBatch(filePaths: string[], options: BatchImportOptions): Promise<BatchResult> {
    const result: BatchResult = {
      succeeded: 0,
      failed: 0,
      skipped: 0,
      cancelled: false,
      details: []
    }

    // Track case names imported in this batch to prevent in-batch duplicates
    const importedInBatch = new Set<string>()

    // Track "apply to all" state for duplicate handling
    let applyToAllChoice: DuplicateChoice | null = null

    for (let i = 0; i < filePaths.length; i++) {
      // Check for cancellation before processing each file
      if (options.signal?.aborted === true) {
        result.cancelled = true
        // Mark remaining files as skipped
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

      // Initialize file detail
      const fileDetail: BatchFileDetail = {
        filePath,
        fileName,
        status: 'importing',
        caseName
      }

      try {
        // Check for duplicate case name in database
        let isDuplicate = false
        let existingCaseId: number | null = null

        try {
          const existingCase = this.db.getCaseByName(caseName)
          isDuplicate = true
          existingCaseId = existingCase.id
        } catch (error) {
          // NotFoundError means no duplicate - this is the expected path
          if (!(error instanceof NotFoundError)) {
            throw error // Rethrow unexpected errors
          }
        }

        // Also check in-batch duplicates
        if (importedInBatch.has(caseName) === true) {
          isDuplicate = true
        }

        // Handle duplicate if found
        if (isDuplicate === true) {
          let choice: DuplicateChoice

          // Use "apply to all" choice if set
          if (applyToAllChoice !== null) {
            choice = applyToAllChoice
          } else if (options.onDuplicateFound !== undefined) {
            // Prompt user for choice
            const response = await options.onDuplicateFound(fileName, caseName)
            choice = response.choice

            // Store choice if "apply to all" was selected
            if (response.applyToAll === true) {
              applyToAllChoice = response.choice
            }
          } else {
            // No callback provided, default to skip
            choice = 'skip'
          }

          if (choice === 'skip') {
            fileDetail.status = 'skipped'
            fileDetail.error = 'Duplicate case name'
            result.details.push(fileDetail)
            result.skipped++
            continue
          } else if (choice === 'overwrite' && existingCaseId !== null) {
            // Delete existing case before importing
            this.db.deleteCase(existingCaseId)
            // Remove from in-batch tracking if it was there
            importedInBatch.delete(caseName)
          }
        }

        // Import the file
        const importResult = await this.importService.importVariants(filePath, {
          caseName,
          onProgress: options.onFileProgress,
          signal: options.signal
        })

        // Success
        fileDetail.status = 'success'
        fileDetail.variantCount = importResult.variantCount
        result.details.push(fileDetail)
        result.succeeded++

        // Track this case name as imported in this batch
        importedInBatch.add(caseName)
      } catch (error) {
        // File import failed - record error and continue to next file
        fileDetail.status = 'failed'
        fileDetail.error = error instanceof Error ? error.message : 'Unknown error during import'
        result.details.push(fileDetail)
        result.failed++
        // Continue to next file - do not throw
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
    // Fallback for Windows paths
    const backslashParts = filePath.split('\\')
    return backslashParts[backslashParts.length - 1] ?? 'unknown'
  }

  /**
   * Extract case name from file name
   * Strip .gz and .json extensions
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
