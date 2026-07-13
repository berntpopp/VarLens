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
    super(`Invalid BED row: ${line}`)
    this.name = 'InvalidBedRowError'
  }
}

export interface BedReaderOptions {
  /** Override the production entry cap in focused tests. */
  maxEntries?: number
  /** Web region-file import preserves its fail-fast malformed-row behavior. */
  rejectMalformedRows?: boolean
}

function isIgnoredBedLine(line: string): boolean {
  return (
    line === '' || line.startsWith('#') || line.startsWith('track') || line.startsWith('browser')
  )
}

export function parseBedEntry(line: string): BedEntry | null {
  const trimmed = line.trim()
  if (isIgnoredBedLine(trimmed)) return null

  const parts = trimmed.split(/\s+/u)
  if (parts.length < 3 || parts[0] === '') return null
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
        if (options.rejectMalformedRows === true && !isIgnoredBedLine(line.trim())) {
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
