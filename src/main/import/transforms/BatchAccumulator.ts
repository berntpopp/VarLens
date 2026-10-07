import { Transform, TransformCallback } from 'node:stream'
import type { Variant } from '../../database/types'
import type { ProgressCallback } from '../types'
import { DATABASE_CONFIG } from '../../../shared/config'
import { createBoundedBatcher, getRecordBytes, type BoundedBatcher } from '../bounded-batcher'

type MappedVariant = Omit<Variant, 'id' | 'case_id'>

export type FlushFn = (caseId: number, batch: MappedVariant[]) => void

interface BatchAccumulatorOptions {
  caseId: number
  batchSize: number
  /** Byte budget per batch; defaults to DATABASE_CONFIG.BATCH_INSERT_MAX_BYTES. */
  maxBatchBytes?: number
  flushFn: FlushFn
  onProgress?: ProgressCallback
  startTime: number
  isCancelled?: () => boolean
}

export class BatchAccumulator extends Transform {
  private readonly batcher: BoundedBatcher<MappedVariant, void>
  private totalInserted = 0
  private skipped = 0
  private readonly onProgress?: ProgressCallback
  private readonly startTime: number
  private readonly isCancelled?: () => boolean

  constructor(options: BatchAccumulatorOptions) {
    super({ objectMode: true })
    this.onProgress = options.onProgress
    this.startTime = options.startTime
    this.isCancelled = options.isCancelled
    this.batcher = createBoundedBatcher<MappedVariant, void>({
      maxRows: options.batchSize,
      maxBytes: options.maxBatchBytes ?? DATABASE_CONFIG.BATCH_INSERT_MAX_BYTES,
      flush: (batch) => {
        options.flushFn(options.caseId, batch)
        this.totalInserted += batch.length
        this.onProgress?.({
          phase: 'inserting',
          count: this.totalInserted,
          elapsed: Date.now() - this.startTime,
          skipped: this.skipped
        })
      }
    })
  }

  _transform(
    chunk: MappedVariant | null,
    _encoding: BufferEncoding,
    callback: TransformCallback
  ): void {
    // Check for cancellation before processing
    if (this.isCancelled !== undefined && this.isCancelled()) {
      this.destroy(new Error('Import cancelled'))
      return
    }

    // Null chunks indicate skipped variants from FieldMapper
    if (chunk === null) {
      this.skipped++
      callback()
      return
    }

    if (this.batcher.add(chunk, getRecordBytes(chunk))) this.batcher.flush()

    callback()
  }

  _flush(callback: TransformCallback): void {
    // Insert any remaining variants
    this.batcher.flush()
    callback()
  }

  get inserted(): number {
    return this.totalInserted
  }

  get skippedCount(): number {
    return this.skipped
  }
}

export function createBatchAccumulator(options: BatchAccumulatorOptions): BatchAccumulator {
  return new BatchAccumulator(options)
}
