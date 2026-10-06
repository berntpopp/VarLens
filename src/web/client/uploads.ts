/**
 * Browser file pickers and upload staging for web mode (spec §4.5).
 *
 * Desktop import pickers return local paths; in the browser the picked files
 * are uploaded to `POST /api/import/upload` and the returned opaque refs are
 * used in place of paths. Upload progress is broadcast as a window
 * CustomEvent (`WEB_UPLOAD_EVENT`) that the import wizard listens to.
 */
import { API_BASE } from './transport'

export const WEB_UPLOAD_EVENT = 'varlens:web-upload'
export const WEB_UPLOAD_CANCEL_EVENT = 'varlens:web-upload-cancel'

export type WebUploadStatus = 'started' | 'progress' | 'complete' | 'error' | 'aborted'

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

export interface UploadedFileRef {
  ref: string
  fileName: string
  size: number
}

let activeUpload: XMLHttpRequest | null = null
let uploadCancelListenerRegistered = false
let uploadCancelListenerTarget: Window | null = null

function dispatchUploadEvent(detail: WebUploadEventDetail): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  window.dispatchEvent(new CustomEvent<WebUploadEventDetail>(WEB_UPLOAD_EVENT, { detail }))
}

function uploadPercent(loadedBytes: number, totalBytes: number | null): number | null {
  if (totalBytes === null || totalBytes <= 0) return null
  return Math.max(0, Math.min(100, Math.round((loadedBytes / totalBytes) * 100)))
}

function ensureUploadCancelListener(): void {
  if (typeof window === 'undefined') return
  if (uploadCancelListenerRegistered && uploadCancelListenerTarget === window) return
  window.addEventListener(WEB_UPLOAD_CANCEL_EVENT, () => {
    activeUpload?.abort()
  })
  uploadCancelListenerRegistered = true
  uploadCancelListenerTarget = window
}

// Vite's `base` config materialises here at build time. The browser
// loads the SPA from BASE_URL (e.g. `/varlens/`), so API calls have to

async function uploadImportFile(file: File): Promise<UploadedFileRef> {
  return await uploadImportFileWithProgress(file, 0, 1)
}

async function uploadImportFileWithProgress(
  file: File,
  fileIndex: number,
  totalFiles: number
): Promise<UploadedFileRef> {
  return await new Promise<UploadedFileRef>((resolve, reject) => {
    const totalBytes = Number.isFinite(file.size) ? file.size : null
    const xhr = new XMLHttpRequest()
    activeUpload = xhr
    ensureUploadCancelListener()

    dispatchUploadEvent({
      status: 'started',
      fileName: file.name,
      fileIndex,
      totalFiles,
      loadedBytes: 0,
      totalBytes,
      percent: uploadPercent(0, totalBytes)
    })

    if (xhr.upload !== undefined) {
      xhr.upload.onprogress = (event) => {
        const knownTotal = event.lengthComputable ? event.total : totalBytes
        dispatchUploadEvent({
          status: 'progress',
          fileName: file.name,
          fileIndex,
          totalFiles,
          loadedBytes: event.loaded,
          totalBytes: knownTotal,
          percent: uploadPercent(event.loaded, knownTotal)
        })
      }
    }

    xhr.onload = () => {
      activeUpload = null
      const text = xhr.responseText
      if (xhr.status < 200 || xhr.status >= 300) {
        const message = `web upload: ${xhr.status} ${xhr.statusText}: ${text}`
        dispatchUploadEvent({
          status: 'error',
          fileName: file.name,
          fileIndex,
          totalFiles,
          loadedBytes: 0,
          totalBytes,
          percent: null,
          message
        })
        reject(new Error(message))
        return
      }

      dispatchUploadEvent({
        status: 'complete',
        fileName: file.name,
        fileIndex,
        totalFiles,
        loadedBytes: totalBytes ?? file.size,
        totalBytes,
        percent: 100
      })
      try {
        resolve(JSON.parse(text) as UploadedFileRef)
      } catch (error) {
        const message = `web upload: invalid JSON response: ${error instanceof Error ? error.message : String(error)}`
        dispatchUploadEvent({
          status: 'error',
          fileName: file.name,
          fileIndex,
          totalFiles,
          loadedBytes: totalBytes ?? file.size,
          totalBytes,
          percent: 100,
          message
        })
        reject(new Error(message))
      }
    }

    xhr.onerror = () => {
      activeUpload = null
      const message = `web upload: ${xhr.status} ${xhr.statusText}: network error`
      dispatchUploadEvent({
        status: 'error',
        fileName: file.name,
        fileIndex,
        totalFiles,
        loadedBytes: 0,
        totalBytes,
        percent: null,
        message
      })
      reject(new Error(message))
    }

    xhr.onabort = () => {
      activeUpload = null
      dispatchUploadEvent({
        status: 'aborted',
        fileName: file.name,
        fileIndex,
        totalFiles,
        loadedBytes: 0,
        totalBytes,
        percent: null,
        message: 'Upload cancelled'
      })
      reject(new Error('Upload cancelled'))
    }

    xhr.open('POST', `${API_BASE}/import/upload`)
    xhr.withCredentials = true
    xhr.setRequestHeader('content-type', 'application/octet-stream')
    xhr.setRequestHeader('x-varlens-file-name', file.name)
    xhr.send(file)
  })
}

export async function uploadImportFiles(files: readonly File[]): Promise<UploadedFileRef[]> {
  if (files.length === 1) {
    return [await uploadImportFile(files[0])]
  }
  const uploaded: UploadedFileRef[] = []
  for (let index = 0; index < files.length; index++) {
    uploaded.push(await uploadImportFileWithProgress(files[index], index, files.length))
  }
  return uploaded
}

async function pickFiles(params: {
  multiple: boolean
  accept: string
  directory?: boolean
}): Promise<File[]> {
  const cancelFallbackDelayMs = 2000
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = params.accept
  input.multiple = params.multiple
  if (params.directory === true) {
    input.setAttribute('webkitdirectory', '')
  }
  input.style.display = 'none'
  document.body.append(input)
  try {
    return await new Promise<File[]>((resolve) => {
      let settled = false
      let cancelTimer: ReturnType<typeof window.setTimeout> | undefined
      const settle = (files: File[]): void => {
        if (settled) return
        settled = true
        if (cancelTimer !== undefined) {
          window.clearTimeout(cancelTimer)
        }
        window.removeEventListener('focus', handleFocus)
        resolve(files)
      }
      const handleFocus = (): void => {
        // Native pickers can restore focus before `change` has populated
        // `input.files`; keep focus as a delayed cancel fallback only.
        cancelTimer = window.setTimeout(() => {
          settle(Array.from(input.files ?? []))
        }, cancelFallbackDelayMs)
      }
      input.addEventListener('change', () => settle(Array.from(input.files ?? [])), { once: true })
      input.addEventListener('cancel', () => settle([]), { once: true })
      window.addEventListener('focus', handleFocus, { once: true })
      input.click()
    })
  } finally {
    input.remove()
  }
}

export async function pickAndUploadFiles(params: {
  multiple: boolean
  accept: string
  directory?: boolean
}): Promise<string[]> {
  const files = await pickFiles(params)
  return (await uploadImportFiles(files)).map((file) => file.ref)
}
