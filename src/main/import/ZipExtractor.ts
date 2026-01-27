import AdmZip from 'adm-zip'
import { resolve, relative } from 'node:path'

export interface ZipExtractionResult {
  extractedFiles: string[]
  errors: string[]
  totalEntries: number
}

export class ZipExtractor {
  isEncrypted(zipPath: string): boolean {
    try {
      const zip = new AdmZip(zipPath)
      const entries = zip.getEntries()
      // Note: @types/adm-zip has a typo "encripted" matching the upstream library
      return entries.some((entry) => entry.header.encripted === true)
    } catch {
      return false
    }
  }

  extract(zipPath: string, targetDir: string, password?: string): ZipExtractionResult {
    const zip = new AdmZip(zipPath)
    const entries = zip.getEntries()
    const result: ZipExtractionResult = {
      extractedFiles: [],
      errors: [],
      totalEntries: entries.length
    }

    for (const entry of entries) {
      if (entry.isDirectory) continue

      const entryName = entry.entryName
      const lowerName = entryName.toLowerCase()
      if (
        !lowerName.endsWith('.json.gz') &&
        !lowerName.endsWith('.gz') &&
        !lowerName.endsWith('.json')
      ) {
        continue
      }

      if (!this.validatePath(targetDir, entryName)) {
        result.errors.push(`Rejected path traversal attempt: ${entryName}`)
        continue
      }

      try {
        zip.extractEntryTo(entry, targetDir, false, true, false, password ?? undefined)
        const basename = entryName.split('/').pop() ?? entryName
        const extractedPath = resolve(targetDir, basename)
        result.extractedFiles.push(extractedPath)
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        result.errors.push(`Failed to extract ${entryName}: ${errorMsg}`)
      }
    }

    return result
  }

  testPassword(zipPath: string, password: string): boolean {
    try {
      const zip = new AdmZip(zipPath)
      const entries = zip.getEntries()
      if (entries.length === 0) return true
      const firstFile = entries.find((e) => !e.isDirectory)
      if (firstFile === undefined) return true
      // adm-zip runtime accepts password arg but @types/adm-zip doesn't declare it
      const getDataWithPassword = firstFile as unknown as {
        getData: (pass: string) => Buffer
      }
      getDataWithPassword.getData(password)
      return true
    } catch {
      return false
    }
  }

  private validatePath(targetDir: string, entryPath: string): boolean {
    if (entryPath.includes('..')) return false
    if (entryPath.startsWith('/')) return false
    if (entryPath.startsWith('\\')) return false
    if (/^[a-zA-Z]:/.test(entryPath)) return false

    const normalizedTarget = resolve(targetDir)
    const resolvedEntry = resolve(normalizedTarget, entryPath)
    const rel = relative(normalizedTarget, resolvedEntry)
    if (rel.startsWith('..')) return false

    return true
  }
}
