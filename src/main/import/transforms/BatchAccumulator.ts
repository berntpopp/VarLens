import { Transform, TransformCallback } from 'node:stream'
import type { Variant } from '../../database/types'
import type { DatabaseService } from '../../database/DatabaseService'
import type { ProgressCallback } from '../types'

type MappedVariant = Omit<Variant, 'id' | 'case_id'>

interface BatchAccumulatorOptions {
  caseId: number
  batchSize: number
  db: DatabaseService
  onProgress?: ProgressCallback
  startTime: number
}

export class BatchAccumulator extends Transform {
  private batch: MappedVariant[] = []
  private totalInserted = 0
  private skipped = 0
  private readonly caseId: number
  private readonly batchSize: number
  private readonly db: DatabaseService
  private readonly onProgress?: ProgressCallback
  private readonly startTime: number

  constructor(options: BatchAccumulatorOptions) {
    super({ objectMode: true })
    this.caseId = options.caseId
    this.batchSize = options.batchSize
    this.db = options.db
    this.onProgress = options.onProgress
    this.startTime = options.startTime
  }

  _transform(
    chunk: MappedVariant | null,
    _encoding: BufferEncoding,
    callback: TransformCallback
  ): void {
    // Null chunks indicate skipped variants from FieldMapper
    if (chunk === null) {
      this.skipped++
      callback()
      return
    }

    this.batch.push(chunk)

    if (this.batch.length >= this.batchSize) {
      this.flushBatch()
    }

    callback()
  }

  _flush(callback: TransformCallback): void {
    // Insert any remaining variants
    if (this.batch.length > 0) {
      this.flushBatch()
    }
    callback()
  }

  private flushBatch(): void {
    if (this.batch.length === 0) return

    this.db.variants.insertVariantsBatch(this.caseId, this.batch)
    this.totalInserted += this.batch.length

    if (this.onProgress) {
      this.onProgress({
        phase: 'inserting',
        count: this.totalInserted,
        elapsed: Date.now() - this.startTime,
        skipped: this.skipped
      })
    }

    this.batch = []
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
