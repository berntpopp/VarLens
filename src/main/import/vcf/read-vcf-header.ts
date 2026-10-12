/**
 * Read a stored case's VCF header lines for the build re-check of the
 * chromosome-name migration. Reads at most `maxBytes` of the file, plain or
 * (b)gzip, and returns the `##` lines found there; a missing, unreadable or
 * non-VCF file gives no lines (no evidence), never an error.
 *
 * Sync for the SQLite migration (it runs in the migration worker); async for
 * the PostgreSQL job, which runs in the web server's event loop.
 */
import { closeSync, openSync, readSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { promisify } from 'node:util'
import { constants, gunzip, gunzipSync } from 'node:zlib'

export const HEADER_READ_MAX_BYTES = 8 * 1024 * 1024

// A truncated gzip stream (only the head is read) is fine with a sync flush.
const GUNZIP_OPTIONS = { finishFlush: constants.Z_SYNC_FLUSH }
const gunzipAsync = promisify(gunzip)

const isGzip = (raw: Buffer): boolean => raw.length > 2 && raw[0] === 0x1f && raw[1] === 0x8b

function headerLines(text: string): string[] {
  const all = text.split(/\r?\n/)
  const end = all.findIndex((line) => !line.startsWith('##'))
  // No line after the header was read: the last one may be cut off mid-way.
  return end >= 0 ? all.slice(0, end) : all.slice(0, -1)
}

const hasPath = (filePath: string | null | undefined): filePath is string =>
  filePath !== null && filePath !== undefined && filePath !== ''

export function readVcfHeaderLinesSync(
  filePath: string | null | undefined,
  maxBytes = HEADER_READ_MAX_BYTES
): string[] {
  if (!hasPath(filePath)) return []
  try {
    const fd = openSync(filePath, 'r')
    let raw: Buffer
    try {
      const buffer = Buffer.alloc(maxBytes)
      raw = buffer.subarray(0, readSync(fd, buffer, 0, maxBytes, 0))
    } finally {
      closeSync(fd)
    }
    return headerLines((isGzip(raw) ? gunzipSync(raw, GUNZIP_OPTIONS) : raw).toString('utf8'))
  } catch {
    return []
  }
}

export async function readVcfHeaderLines(
  filePath: string | null | undefined,
  maxBytes = HEADER_READ_MAX_BYTES
): Promise<string[]> {
  if (!hasPath(filePath)) return []
  try {
    const handle = await open(filePath, 'r')
    let raw: Buffer
    try {
      const { buffer, bytesRead } = await handle.read(Buffer.alloc(maxBytes), 0, maxBytes, 0)
      raw = buffer.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
    const text = isGzip(raw) ? await gunzipAsync(raw, GUNZIP_OPTIONS) : raw
    return headerLines(text.toString('utf8'))
  } catch {
    return []
  }
}
