import AdmZip from 'adm-zip'
import { statSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, relative, basename, dirname, sep } from 'node:path'
import { mainLogger } from '../services/MainLogger'

export interface ZipExtractionResult {
  extractedFiles: string[]
  errors: string[]
  totalEntries: number
}

export interface ZipResourceLimits {
  maxArchiveBytes: number
  maxEntries: number
  maxEntryUncompressedBytes: number
  maxTotalUncompressedBytes: number
}

/** @deprecated Use ZipResourceLimits for archive-wide bounds as well. */
export type ZipPasswordValidationLimits = Pick<
  ZipResourceLimits,
  'maxEntryUncompressedBytes' | 'maxTotalUncompressedBytes'
>

const DEFAULT_ZIP_RESOURCE_LIMITS: ZipResourceLimits = {
  // adm-zip reads/parses archives and decodes entries synchronously on the
  // Electron main thread. ZIP is a batch convenience path; larger clinical
  // inputs should use the directly streamed JSON/VCF import paths.
  maxArchiveBytes: 256 * 1024 * 1024,
  maxEntries: 10_000,
  maxEntryUncompressedBytes: 128 * 1024 * 1024,
  maxTotalUncompressedBytes: 512 * 1024 * 1024
}

type ZipArchive = Pick<AdmZip, 'getEntries'>
type OpenZipArchive = (zipPath: string) => ZipArchive

class ZipResourceLimitError extends Error {}

interface ZipExtractionCandidate {
  entry: AdmZip.IZipEntry
  entryName: string
  extractedPath: string
}

export class ZipExtractor {
  private readonly resourceLimits: ZipResourceLimits

  constructor(
    resourceLimits: Partial<ZipResourceLimits> = {},
    private readonly openArchive: OpenZipArchive = (zipPath) => new AdmZip(zipPath),
    private readonly archiveSize: (zipPath: string) => number = (zipPath) => statSync(zipPath).size
  ) {
    this.resourceLimits = { ...DEFAULT_ZIP_RESOURCE_LIMITS, ...resourceLimits }
  }

  /**
   * Check if a ZIP file is password-protected.
   * Checks both "encrypted" (current adm-zip) and "encripted" (legacy typo)
   * because @types/adm-zip declares the typo while runtime uses the corrected name.
   */
  isEncrypted(zipPath: string): boolean {
    try {
      this.assertArchiveSizeWithinLimit(zipPath)
      const zip = this.openArchive(zipPath)
      const entries = zip.getEntries()
      this.assertEntryCountWithinLimit(entries.length)
      return entries.some((entry) => {
        const header = entry.header as unknown as Record<string, unknown>
        return header['encrypted'] === true || header['encripted'] === true
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      mainLogger.error(`Failed to inspect ZIP archive encryption: ${message}`, 'ZipExtractor')
      throw new Error(`Failed to inspect ZIP archive: ${message}`, { cause: e })
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
    this.assertArchiveSizeWithinLimit(zipPath)
    const zip = this.openArchive(zipPath)
    const entries = zip.getEntries()
    this.assertEntryCountWithinLimit(entries.length)
    const result: ZipExtractionResult = {
      extractedFiles: [],
      errors: [],
      totalEntries: entries.length
    }

    const candidates = this.preflightExtraction(entries, targetDir, result.errors)
    if (result.errors.length > 0) return result

    let actualTotalBytes = 0
    for (const { entry, entryName, extractedPath } of candidates) {
      try {
        // Use getData(password) for decryption — extractEntryTo() and extractAllTo()
        // can trigger uncaught async zlib errors that crash Electron.
        // getData() decrypts synchronously and errors are catchable.
        const getDataFn = entry as unknown as { getData: (pass?: string) => Buffer }
        const data =
          password !== undefined && password !== '' ? getDataFn.getData(password) : entry.getData()

        this.assertEntrySizeWithinLimit(entryName, data.length, 'extraction')
        actualTotalBytes += data.length
        this.assertTotalSizeWithinLimit(actualTotalBytes, 'extraction')

        await mkdir(dirname(extractedPath))
        await writeFile(extractedPath, data)
        result.extractedFiles.push(resolve(extractedPath))
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        result.errors.push(
          `Failed to extract ${entryName}: ${this.redactSecret(errorMsg, password ?? '')}`
        )
        if (error instanceof ZipResourceLimitError) break
      }
    }

    return result
  }

  /**
   * Test if a ZIP archive can be opened with the given password.
   * Attempts to read every file entry as a verification check.
   *
   * Distinguishes three outcomes deliberately:
   * - The archive itself cannot be opened/parsed (corrupt file, wrong format,
   *   unreadable path) — this is an infrastructure fault, not a password
   *   problem, so it throws rather than being reported as "wrong password".
   * - An encrypted entry explicitly rejects the supplied password — this is
   *   recorded as the legitimate "wrong password" outcome, but validation
   *   continues so a later corrupt entry cannot be hidden by entry ordering.
   * - Any entry decodes far enough to report CRC/decompression failure
   *   fails — the archive is corrupt, not password-protected, so this must
   *   throw too. Otherwise a corrupt-but-unencrypted entry is indistinguishable
   *   from a genuine wrong-password result.
   *
   * Returns `true` only when at least one encrypted entry exists and all
   * encrypted entries accept the supplied password.
   */
  testPassword(zipPath: string, password: string): boolean {
    let entries: AdmZip.IZipEntry[]
    try {
      this.assertArchiveSizeWithinLimit(zipPath)
      const zip = this.openArchive(zipPath)
      entries = zip.getEntries()
      this.assertEntryCountWithinLimit(entries.length)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      mainLogger.error(`Failed to open ZIP archive for password test: ${message}`, 'ZipExtractor')
      throw new Error(`Failed to open ZIP archive: ${message}`, { cause: e })
    }

    let encryptedEntryCount = 0
    let passwordRejected = false
    let declaredTotalBytes = 0
    let actualTotalBytes = 0

    for (const entry of entries) {
      if (entry.isDirectory) continue
      const header = entry.header as unknown as Record<string, unknown>
      const isEntryEncrypted = header['encrypted'] === true || header['encripted'] === true
      if (isEntryEncrypted) encryptedEntryCount++

      const declaredSize = header['size']
      this.assertEntrySizeWithinLimit(entry.entryName, declaredSize, 'password validation')
      declaredTotalBytes += declaredSize
      this.assertTotalSizeWithinLimit(declaredTotalBytes, 'password validation')

      let data: Buffer
      try {
        // adm-zip runtime accepts password arg but @types/adm-zip doesn't declare it
        const getDataWithPassword = entry as unknown as {
          getData: (pass: string) => Buffer
        }
        data = getDataWithPassword.getData(password)
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        if (isEntryEncrypted && /wrong password/i.test(message)) {
          mainLogger.warn(`ZIP password rejected for ${entry.entryName}`, 'ZipExtractor')
          passwordRejected = true
          continue
        }

        this.throwCorruptEntry(entry.entryName, message, password)
      }

      this.assertEntrySizeWithinLimit(entry.entryName, data.length, 'password validation')
      actualTotalBytes += data.length
      this.assertTotalSizeWithinLimit(actualTotalBytes, 'password validation')
    }

    return encryptedEntryCount > 0 && !passwordRejected
  }

  private assertEntrySizeWithinLimit(
    entryName: string,
    size: unknown,
    operation: 'password validation' | 'extraction'
  ): asserts size is number {
    if (!Number.isSafeInteger(size) || (size as number) < 0) {
      throw new Error(`Invalid uncompressed size for ZIP archive entry ${entryName}`)
    }
    if ((size as number) > this.resourceLimits.maxEntryUncompressedBytes) {
      throw new ZipResourceLimitError(
        `ZIP ${operation} limit exceeded for entry ${entryName}: maximum ${this.resourceLimits.maxEntryUncompressedBytes} bytes`
      )
    }
  }

  private assertTotalSizeWithinLimit(
    size: number,
    operation: 'password validation' | 'extraction'
  ): void {
    if (size > this.resourceLimits.maxTotalUncompressedBytes) {
      throw new ZipResourceLimitError(
        `ZIP ${operation} total limit exceeded: maximum ${this.resourceLimits.maxTotalUncompressedBytes} bytes`
      )
    }
  }

  private assertArchiveSizeWithinLimit(zipPath: string): void {
    const size = this.archiveSize(zipPath)
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new ZipResourceLimitError(`Invalid ZIP archive size for ${zipPath}`)
    }
    if (size > this.resourceLimits.maxArchiveBytes) {
      throw new ZipResourceLimitError(
        `ZIP archive size limit exceeded: maximum ${this.resourceLimits.maxArchiveBytes} bytes`
      )
    }
  }

  private assertEntryCountWithinLimit(count: number): void {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new ZipResourceLimitError('Invalid ZIP archive entry count')
    }
    if (count > this.resourceLimits.maxEntries) {
      throw new ZipResourceLimitError(
        `ZIP archive entry count limit exceeded: maximum ${this.resourceLimits.maxEntries} entries`
      )
    }
  }

  private redactSecret(message: string, secret: string): string {
    return secret === '' ? message : message.split(secret).join('[REDACTED]')
  }

  private throwCorruptEntry(entryName: string, message: string, password: string): never {
    mainLogger.error(`ZIP archive entry is corrupt: ${entryName}`, 'ZipExtractor')
    const sanitizedMessage = this.redactSecret(message, password)
    throw new Error(`Corrupt ZIP archive entry ${entryName}: ${sanitizedMessage}`, {
      cause: new Error(sanitizedMessage)
    })
  }

  private preflightExtraction(
    entries: AdmZip.IZipEntry[],
    targetDir: string,
    errors: string[]
  ): ZipExtractionCandidate[] {
    const candidates: ZipExtractionCandidate[] = []
    const flattenedNames = new Map<string, string>()
    const normalizedTarget = resolve(targetDir)
    let declaredTotalBytes = 0

    for (const entry of entries) {
      if (entry.isDirectory || !this.isImportableEntry(entry.entryName)) continue

      const entryName = entry.entryName
      if (!this.validatePath(targetDir, entryName)) {
        errors.push(`Rejected path traversal attempt: ${entryName}`)
        continue
      }

      const fileName = basename(entryName)
      try {
        const header = entry.header as unknown as Record<string, unknown>
        const declaredSize = header['size']
        this.assertEntrySizeWithinLimit(entryName, declaredSize, 'extraction')
        declaredTotalBytes += declaredSize
        this.assertTotalSizeWithinLimit(declaredTotalBytes, 'extraction')
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
        continue
      }

      const childDirectory = `entry-${String(candidates.length + 1).padStart(6, '0')}`
      const extractedPath = resolve(targetDir, childDirectory, fileName)
      if (!extractedPath.startsWith(normalizedTarget + sep)) {
        errors.push(`Rejected path traversal attempt: ${entryName}`)
        continue
      }

      const collisionKey = fileName.normalize('NFC').toLowerCase()
      const existingEntry = flattenedNames.get(collisionKey)
      if (existingEntry !== undefined) {
        errors.push(
          `Duplicate flattened basename ${fileName}: entries ${existingEntry} and ${entryName}`
        )
        continue
      }

      flattenedNames.set(collisionKey, entryName)
      candidates.push({ entry, entryName, extractedPath })
    }

    return errors.length === 0 ? candidates : []
  }

  private isImportableEntry(entryName: string): boolean {
    const lowerName = entryName.toLowerCase()
    return (
      lowerName.endsWith('.json.gz') || lowerName.endsWith('.gz') || lowerName.endsWith('.json')
    )
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
