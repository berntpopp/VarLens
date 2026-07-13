import { createInterface } from 'node:readline'
import { statSync } from 'node:fs'
import { createCappedLineStream, DecompressedSizeExceededError } from '../stream-utils'

export interface BedEntry {
  chr: string
  start: number
  end: number
  label?: string
}

function isIgnoredBedLine(line: string): boolean {
  return (
    line === '' || line.startsWith('#') || line.startsWith('track') || line.startsWith('browser')
  )
}

export function parseBedEntry(line: string): BedEntry | null {
  const trimmed = line.trim()
  if (isIgnoredBedLine(trimmed)) return null

  const parts = trimmed.split('\t')
  if (parts.length < 3) return null
  if (!/^\d+$/.test(parts[1]) || !/^\d+$/.test(parts[2])) return null

  const start = Number(parts[1])
  const end = Number(parts[2])
  if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) return null

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
  maxDecompressedBytes: number
): AsyncGenerator<BedEntry, void, void> {
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

  try {
    for await (const line of lines) {
      if (streamError !== null) throw streamError
      const entry = parseBedEntry(line)
      if (entry !== null) yield entry
    }
    if (streamError !== null) throw streamError
  } finally {
    lines.close()
    stream.destroy()
  }
}
