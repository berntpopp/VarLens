import AdmZip from 'adm-zip'
import { writeFile } from 'node:fs/promises'
import { resolve, relative, basename, sep } from 'node:path'
import { mainLogger } from '../services/MainLogger'

export interface ZipExtractionResult {
  extractedFiles: string[]
  errors: string[]
  totalEntries: number
}

export class ZipExtractor {
  /**
   * Check if a ZIP file is password-protected.
   * Checks both "encrypted" (current adm-zip) and "encripted" (legacy typo)
   * because @types/adm-zip declares the typo while runtime uses the corrected name.
   */
  isEncrypted(zipPath: string): boolean {
    try {
      const zip = new AdmZip(zipPath)
      const entries = zip.getEntries()
      return entries.some((entry) => {
        const header = entry.header as unknown as Record<string, unknown>
        return header['encrypted'] === true || header['encripted'] === true
      })
    } catch (e) {
      mainLogger.warn(
        'Failed to check ZIP encryption: ' + (e instanceof Error ? e.message : String(e)),
        'ZipExtractor'
      )
      return false
    }
  }

  /**
   * Extract JSON/gz files from a ZIP archive to a target directory.
   *
   * Uses per-entry getData(password) + writeFile instead of extractAllTo()
   * because extractAllTo() can trigger uncaught async zlib errors that crash
   * the Electron main process. getData() handles decryption synchronously and
   * errors can be caught per-entry.
   *
   * @param zipPath - Path to the ZIP file
   * @param targetDir - Directory to extract files into (must already exist)
   * @param password - Optional password for encrypted archives
   * @returns Promise resolving to extraction result with file paths and any errors
   */
  async extract(
    zipPath: string,
    targetDir: string,
    password?: string
  ): Promise<ZipExtractionResult> {
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
        // Use getData(password) for decryption — extractEntryTo() and extractAllTo()
        // can trigger uncaught async zlib errors that crash Electron.
        // getData() decrypts synchronously and errors are catchable.
        const getDataFn = entry as unknown as { getData: (pass?: string) => Buffer }
        const data =
          password !== undefined && password !== '' ? getDataFn.getData(password) : entry.getData()

        const fileName = basename(entryName)
        const extractedPath = resolve(targetDir, fileName)
        const normalizedTarget = resolve(targetDir)
        if (!extractedPath.startsWith(normalizedTarget + sep)) {
          result.errors.push(`Rejected path traversal attempt: ${entryName}`)
          continue
        }
        await writeFile(extractedPath, data)
        result.extractedFiles.push(resolve(extractedPath))
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        result.errors.push(`Failed to extract ${entryName}: ${errorMsg}`)
      }
    }

    return result
  }

  /**
   * Test if a ZIP archive can be opened with the given password.
   * Attempts to read the first entry as a verification check.
   */
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
    } catch (e) {
      mainLogger.warn(
        'ZIP password test failed: ' + (e instanceof Error ? e.message : String(e)),
        'ZipExtractor'
      )
      return false
    }
  }

  /**
   * Validate an entry path to prevent Zip Slip path traversal.
   * Defense-in-depth: checks multiple attack vectors.
   */
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
