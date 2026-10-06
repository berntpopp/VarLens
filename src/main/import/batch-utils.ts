import { basename } from 'path'
import type { DatabaseService } from '../database/DatabaseService'

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
 * Extract case name from file name (strip extensions and optional user text)
 */
export function extractCaseName(fileName: string, stripText?: string): string {
  let name = fileName
  if (name.endsWith('.gz') === true) {
    name = name.slice(0, -3)
  }
  if (name.endsWith('.json') === true) {
    name = name.slice(0, -5)
  }
  if (stripText !== undefined && stripText !== '') {
    name = name.split(stripText).join('').trim()
  }
  return name
}

/**
 * The duplicate rule shared by every runtime (desktop SQLite, desktop/web
 * Postgres): a file is a duplicate when its derived case name already exists.
 */
export function buildDuplicateReport(
  files: ReadonlyArray<{ filePath: string; fileName: string }>,
  existingNames: ReadonlySet<string>,
  stripText?: string
): { files: DuplicateCheckItem[]; duplicateCount: number } {
  let duplicateCount = 0
  const report = files.map(({ filePath, fileName }) => {
    const caseName = extractCaseName(fileName, stripText)
    const isDuplicate = existingNames.has(caseName)
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
  const existingNames = db.cases.getExistingCaseNames(
    files.map((f) => extractCaseName(f.fileName, stripText))
  )
  return buildDuplicateReport(files, existingNames, stripText)
}
