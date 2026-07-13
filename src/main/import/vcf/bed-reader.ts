import { createInterface } from 'node:readline'
import { statSync } from 'node:fs'
import { createCappedLineStream, DecompressedSizeExceededError } from '../stream-utils'

export interface BedEntry {
  chr: string
  start: number
  end: number
  label?: string
}

/**
 * Intentional object-memory budget for consumers that collect the stream.
 * One million typical short chromosome/label entries occupy roughly
 * 100-200 MiB in V8; together with the independent 256 MiB decompressed BED
 * cap used by production callers, even adversarial retained strings keep the
 * expected peak below roughly 1 GiB instead of allowing unbounded growth.
 * The generous count still accommodates large capture/genome interval sets.
 */
export const MAX_BED_ENTRIES = 1_000_000

export class BedEntryLimitExceededError extends Error {
  constructor(maxEntries: number) {
    super(`Refusing to read more than ${maxEntries} valid BED entries from a single file`)
    this.name = 'BedEntryLimitExceededError'
  }
}

export class InvalidBedRowError extends Error {
  constructor(line: string) {
    const preview = line.length > 256 ? `${line.slice(0, 256)}…` : line
    super(`Invalid BED row (${line.length} characters): ${preview}`)
    this.name = 'InvalidBedRowError'
  }
}

export interface BedReaderOptions {
  /** Override the production entry cap in focused tests. */
  maxEntries?: number
  /** Web region-file import preserves its fail-fast malformed-row behavior. */
  rejectMalformedRows?: boolean
}

function isIgnoredBedFirstField(firstField: string | undefined): boolean {
  return (
    firstField === undefined ||
    firstField.startsWith('#') ||
    firstField === 'track' ||
    firstField === 'browser'
  )
}

export function parseBedEntry(line: string): BedEntry | null {
  const parts = scanBedFields(line, 4)
  if (isIgnoredBedFirstField(parts[0])) return null
  if (parts.length < 3) return null
  if (!/^\d+$/.test(parts[1]) || !/^\d+$/.test(parts[2])) return null

  const start = Number(parts[1])
  const end = Number(parts[2])
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start) return null

  return {
    chr: parts[0],
    start,
    end,
    label: parts.length >= 4 ? parts[3] : undefined
  }
}

/** Read only the BED3/BED4 fields consumed by VarLens; never split a dense remainder. */
function scanBedFields(line: string, maxFields: number): string[] {
  const fields: string[] = []
  let index = 0
  while (fields.length < maxFields) {
    while (index < line.length && isBedWhitespace(line.charCodeAt(index))) index += 1
    if (index === line.length) break
    const start = index
    while (index < line.length && !isBedWhitespace(line.charCodeAt(index))) index += 1
    fields.push(line.slice(start, index))
  }
  return fields
}

function isBedWhitespace(charCode: number): boolean {
  return charCode === 0x09 || charCode === 0x20 || charCode === 0x0b || charCode === 0x0c
}

/** Iterate a BED file without materializing its decompressed text. */
export async function* readBedEntries(
  filePath: string,
  maxDecompressedBytes: number,
  options: BedReaderOptions = {}
): AsyncGenerator<BedEntry, void, void> {
  const maxEntries = options.maxEntries ?? MAX_BED_ENTRIES
  if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
    throw new TypeError('BED entry cap must be a positive safe integer')
  }
  // Fail synchronously before createReadStream can emit an open error after a
  // rejected consumer has already settled. The size check also rejects a
  // plainly oversized BED before reading its sparse/zero-filled contents.
  if (statSync(filePath).size > maxDecompressedBytes) {
    throw new DecompressedSizeExceededError(maxDecompressedBytes)
  }
  const { stream } = createCappedLineStream(filePath, { maxDecompressedBytes })
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  let streamError: Error | null = null

  const captureStreamError = (error: Error): void => {
    streamError ??= error
    lines.close()
  }
  stream.on('error', captureStreamError)
  let entryCount = 0

  try {
    for await (const line of lines) {
      if (streamError !== null) throw streamError
      const entry = parseBedEntry(line)
      if (entry === null) {
        if (
          options.rejectMalformedRows === true &&
          !isIgnoredBedFirstField(scanBedFields(line, 1)[0])
        ) {
          throw new InvalidBedRowError(line)
        }
        continue
      }
      entryCount += 1
      if (entryCount > maxEntries) throw new BedEntryLimitExceededError(maxEntries)
      yield entry
    }
    if (streamError !== null) throw streamError
  } finally {
    lines.close()
    stream.destroy()
  }
}
