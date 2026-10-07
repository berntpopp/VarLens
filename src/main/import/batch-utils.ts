import { basename } from 'path'
import type { DatabaseService } from '../database/DatabaseService'
import { deriveCaseName, legacyCaseName, resolveCaseName } from '../../shared/utils/case-name'

export interface DuplicateCheckItem {
  filePath: string
  fileName: string
  caseName: string
  isDuplicate: boolean
}

/**
 * Extract file name from path
 */
export function extractFileName(filePath: string): string {
  return basename(filePath) || 'unknown'
}

/**
 * Extract case name from file name (strip extensions and optional user text).
 * The rule itself lives in src/shared/utils/case-name.ts.
 */
export function extractCaseName(fileName: string, stripText?: string): string {
  return deriveCaseName(fileName, stripText)
}

/**
 * The duplicate rule shared by every runtime (desktop SQLite, desktop/web
 * Postgres): a file is a duplicate when its derived case name already exists,
 * or when a case imported before `.vcf` was stripped exists under the legacy
 * name (then `caseName` is that existing name; see {@link resolveCaseName}).
 */
export function buildDuplicateReport(
  files: ReadonlyArray<{ filePath: string; fileName: string }>,
  existingNames: ReadonlySet<string>,
  stripText?: string
): { files: DuplicateCheckItem[]; duplicateCount: number } {
  let duplicateCount = 0
  const report = files.map(({ filePath, fileName }) => {
    const { caseName, isDuplicate } = resolveCaseName(fileName, stripText, (name) =>
      existingNames.has(name)
    )
    if (isDuplicate) duplicateCount++
    return { filePath, fileName, caseName, isDuplicate }
  })
  return { files: report, duplicateCount }
}

/**
 * Check which files have duplicate case names in the database.
 */
export function checkDuplicates(
  db: DatabaseService,
  filePaths: string[],
  stripText?: string
): { files: DuplicateCheckItem[]; duplicateCount: number } {
  const files = filePaths.map((filePath) => ({ filePath, fileName: extractFileName(filePath) }))
  // Single batched query instead of N individual lookups
  // (legacy names included, so cases imported before `.vcf` was stripped match)
  const candidates = new Set<string>()
  for (const f of files) {
    candidates.add(deriveCaseName(f.fileName, stripText))
    candidates.add(legacyCaseName(f.fileName, stripText))
  }
  const existingNames = db.cases.getExistingCaseNames([...candidates])
  return buildDuplicateReport(files, existingNames, stripText)
}
