/**
 * The one batching rule shared by every import writer: a batch is handed to
 * the database when it reaches `maxRows` records OR `maxBytes` of source
 * data, whichever comes first.
 *
 * Counting rows alone bounds nothing useful, because one JSON record may be
 * 1 MiB and one VCF line 64 MiB (issue #445). The limit is checked after a
 * record is added, so a batch holds at most `maxBytes` plus one record.
 */
import { DATABASE_CONFIG } from '../../shared/config'
import { InvalidParametersError } from '../ipc/errors'

export interface BoundedBatcherOptions<T, R> {
  maxRows: number
  maxBytes: number
  /** Receives the batch and its accounted size. The batcher is already empty. */
  flush: (rows: T[], bytes: number) => R
}

export interface BoundedBatcher<T, R> {
  /**
   * Add one record. Returns true once a limit is reached; the caller then
   * calls {@link BoundedBatcher.flush} (and awaits it for an async writer).
   */
  add: (row: T, bytes: number) => boolean
  /** Hand the pending rows to `flush`. Does nothing when the batch is empty. */
  flush: () => R | undefined
  readonly rows: number
  readonly bytes: number
}

export function createBoundedBatcher<T, R>(
  options: BoundedBatcherOptions<T, R>
): BoundedBatcher<T, R> {
  const { maxRows, maxBytes, flush } = options
  let rows: T[] = []
  let bytes = 0

  return {
    add(row, rowBytes) {
      rows.push(row)
      if (rowBytes > 0 && Number.isFinite(rowBytes)) bytes += rowBytes
      return rows.length >= maxRows || bytes >= maxBytes
    },
    flush() {
      if (rows.length === 0) return undefined
      const batch = rows
      const batchBytes = bytes
      // Reset first: a batch whose write threw must not be offered again by
      // the caller's end-of-stream flush.
      rows = []
      bytes = 0
      return flush(batch, batchBytes)
    },
    get rows() {
      return rows.length
    },
    get bytes() {
      return bytes
    }
  }
}

/**
 * Source size of a mapped record, attached where the size is already known
 * (the JSON record budget, the VCF line reader) and read back by the batcher.
 * A side table keeps the size off the record, so nothing downstream sees it.
 */
const recordBytes = new WeakMap<object, number>()

export function setRecordBytes(record: object, bytes: number): void {
  recordBytes.set(record, bytes)
}

/** Untagged records count as 0 bytes, which leaves only the row limit. */
export function getRecordBytes(record: object): number {
  return recordBytes.get(record) ?? 0
}

/**
 * Validate a requested batch size. `undefined` means "not requested" and
 * yields the fallback; anything else must be an integer in
 * 1..BATCH_INSERT_MAX_ROWS.
 */
export function resolveBatchSize(requested: unknown, fallback: number): number {
  if (requested === undefined) return fallback
  const max = DATABASE_CONFIG.BATCH_INSERT_MAX_ROWS
  if (
    typeof requested !== 'number' ||
    !Number.isInteger(requested) ||
    requested < 1 ||
    requested > max
  ) {
    throw new InvalidParametersError(
      `batchSize must be an integer between 1 and ${max}, received ${String(requested)}`,
      'The import was started with an invalid batch size.'
    )
  }
  return requested
}
