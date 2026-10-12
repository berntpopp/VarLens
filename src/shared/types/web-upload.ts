/**
 * Window events between the web upload client (`src/web/client/uploads.ts`)
 * and the import wizard, which cannot import the web client itself.
 */
export const WEB_UPLOAD_EVENT = 'varlens:web-upload'
export const WEB_UPLOAD_CANCEL_EVENT = 'varlens:web-upload-cancel'
/** Sent by the import wizard with `{ refs }` it abandons before any import used them. */
export const WEB_UPLOAD_DISCARD_EVENT = 'varlens:web-upload-discard'

/** `skipped`: the server refused this one file; the rest of the selection still uploads. */
export type WebUploadStatus = 'started' | 'progress' | 'complete' | 'error' | 'skipped' | 'aborted'

export interface WebUploadEventDetail {
  status: WebUploadStatus
  fileName: string
  fileIndex: number
  totalFiles: number
  loadedBytes: number
  totalBytes: number | null
  percent: number | null
  message?: string
}
