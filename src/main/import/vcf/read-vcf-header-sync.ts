/**
 * Synchronous read of a stored case's VCF header lines, for the build re-check
 * of the chromosome-naming migration (runs inside a synchronous SQLite
 * migration). Reads at most `maxBytes` of the file, plain or (b)gzip, and
 * returns the `##` lines found there; a missing, unreadable or non-VCF file
 * gives no lines (no evidence), never an error.
 */
import { closeSync, openSync, readSync } from 'node:fs'
import { constants, gunzipSync } from 'node:zlib'

export const HEADER_READ_MAX_BYTES = 8 * 1024 * 1024

export function readVcfHeaderLinesSync(
  filePath: string | null | undefined,
  maxBytes = HEADER_READ_MAX_BYTES
): string[] {
  if (filePath === null || filePath === undefined || filePath === '') return []
  let raw: Buffer
  try {
    const fd = openSync(filePath, 'r')
    try {
      const buffer = Buffer.alloc(maxBytes)
      raw = buffer.subarray(0, readSync(fd, buffer, 0, maxBytes, 0))
    } finally {
      closeSync(fd)
    }
  } catch {
    return []
  }
  let text: string
  try {
    const gzip = raw.length > 2 && raw[0] === 0x1f && raw[1] === 0x8b
    // A truncated gzip stream (we read only the head) is fine with a sync flush.
    text = (gzip ? gunzipSync(raw, { finishFlush: constants.Z_SYNC_FLUSH }) : raw).toString('utf8')
  } catch {
    return []
  }
  const all = text.split(/\r?\n/)
  const end = all.findIndex((line) => !line.startsWith('##'))
  // No line after the header was read: the last one may be cut off mid-way.
  return end >= 0 ? all.slice(0, end) : all.slice(0, -1)
}
