/**
 * Per-file events of a SQLite batch import, derived from what the import
 * worker reports.
 *
 * The worker announces an imported file (`file-complete`) and a failed one
 * (per-file `error`), and says nothing when it skips a duplicate. It works
 * through the files in order, so once it is busy with file N every earlier
 * file it never announced was skipped. That lets the main process report
 * imported, skipped and failed files the way the session path
 * (batch-import-session.ts) does, without a worker change. Files a cancel
 * kept from being imported get no event, there as here.
 */
import { basename } from 'path'
import type { BatchFileComplete } from '../../../shared/types/api'
import type { FileImportRequest, WorkerMessage } from '../../../shared/types/import-worker'

type FileCompleteMessage = Extract<WorkerMessage, { type: 'file-complete' }>
type BatchResults = Extract<WorkerMessage, { type: 'complete' }>['results']

export class BatchFileEventReporter {
  private readonly reported: boolean[]
  /** Every file below this index is settled. */
  private settledBelow = 0

  constructor(
    private readonly files: ReadonlyArray<Pick<FileImportRequest, 'filePath' | 'caseName'>>,
    private readonly emit: (event: BatchFileComplete) => void
  ) {
    this.reported = files.map(() => false)
  }

  /**
   * The worker is working on file `index`: earlier silent files were skipped.
   * An index past the last file (the worker's "finalizing" progress) says
   * nothing about the files before it — a cancel may have stopped them.
   */
  reached(index: number): void {
    if (index >= this.files.length) return
    for (let i = this.settledBelow; i < index; i++) this.report(i, { status: 'skipped' })
    this.settledBelow = Math.max(this.settledBelow, index)
  }

  imported(message: FileCompleteMessage): void {
    this.reached(message.fileIndex)
    this.report(message.fileIndex, {
      status: 'success',
      caseName: message.result.caseName,
      caseId: message.result.caseId,
      variantCount: message.result.variantCount
    })
  }

  failed(index: number, error: string): void {
    this.reached(index)
    this.report(index, { status: 'failed', error })
  }

  /**
   * The batch is over: report what the worker's final result knows and no
   * event covered yet (duplicates skipped after the last imported file). In a
   * cancelled batch a trailing skipped file may be one the cancel stopped, so
   * those stay silent.
   */
  finish(results: BatchResults): void {
    if (results.details.length !== this.files.length) return
    results.details.forEach((detail, index) => {
      if (detail.status === 'failed') {
        this.report(index, { status: 'failed', error: detail.error })
      } else if (detail.status === 'skipped' && !results.cancelled) {
        this.report(index, { status: 'skipped' })
      }
    })
  }

  private report(
    index: number,
    event: Pick<BatchFileComplete, 'status'> & Partial<BatchFileComplete>
  ): void {
    const file = this.files[index]
    if (file === undefined || this.reported[index]) return
    this.reported[index] = true
    this.emit({
      index,
      totalFiles: this.files.length,
      fileName: basename(file.filePath) || 'unknown',
      caseName: file.caseName,
      ...event
    })
  }
}
