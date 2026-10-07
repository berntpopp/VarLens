import { statSync, existsSync } from 'node:fs'
import { DatabaseService } from '../database/DatabaseService'
import { mainLogger } from '../services/MainLogger'
import {
  resetUnrankedClinvar,
  takeUnrankedClinvar,
  unrankedClinvarLogLine
} from './unranked-clinvar'
import type { ImportOptions, ImportResult } from './types'
import { importRegistry } from './strategies'
import type { StrategyContext } from './strategies'
import { detectFormat } from './format-detection'

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
    let caseId: number | null = null

    // Fail fast if file doesn't exist
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`)
    }

    try {
      // Detect file format
      const formatInfo = await detectFormat(filePath)

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
        startTime: Date.now()
      }

      // Execute import via strategy
      resetUnrankedClinvar()
      const result = await strategy.import(filePath, options, context)
      const unrankedClinvar = takeUnrankedClinvar()
      if (unrankedClinvar !== undefined) {
        result.unrankedClinvar = unrankedClinvar
        mainLogger.warn(
          unrankedClinvarLogLine(options.caseName ?? filePath, unrankedClinvar),
          'import'
        )
      }

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
}
