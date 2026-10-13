/**
 * Browser file pickers and upload staging for web mode (spec §4.5).
 *
 * Desktop import pickers return local paths; in the browser the picked files
 * are uploaded to `POST /api/import/upload` and the returned opaque refs are
 * used in place of paths. Upload progress is broadcast as a window
 * CustomEvent (`WEB_UPLOAD_EVENT`) that the import wizard listens to.
 */
import { API_BASE } from './transport'
import {
  WEB_UPLOAD_CANCEL_EVENT,
  WEB_UPLOAD_DISCARD_EVENT,
  WEB_UPLOAD_EVENT,
  type WebUploadEventDetail
} from '../../shared/types/web-upload'
import { skippedUploadsSummary, UPLOAD_CONFIG } from '../../shared/config/upload.config'

export interface UploadedFileRef {
  ref: string
  fileName: string
  size: number
}

/** A non-2xx answer; `skippable` when only this file is at fault (type, per-file size). */
class UploadRefusedError extends Error {
  constructor(
    message: string,
    readonly skippable: boolean
  ) {
    super(message)
  }
}

/** The server's `{ userMessage | message }`, not the JSON envelope, prefixed with the file name. */
function refusalMessage(fileName: string, text: string): { message: string; code?: string } {
  try {
    const body = JSON.parse(text) as { error?: string; message?: string; userMessage?: string }
    return { message: `${fileName}: ${body.userMessage ?? body.message ?? text}`, code: body.error }
  } catch {
    return { message: `${fileName}: ${text}` }
  }
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
  window.addEventListener(WEB_UPLOAD_DISCARD_EVENT, (event) => {
    void discardUploads((event as CustomEvent<{ refs: string[] }>).detail.refs)
  })
  uploadCancelListenerRegistered = true
  uploadCancelListenerTarget = window
}

// Vite's `base` config materialises here at build time. The browser
// loads the SPA from BASE_URL (e.g. `/varlens/`), so API calls have to

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
        const { message, code } = refusalMessage(
          file.name,
          text || `${xhr.status} ${xhr.statusText}`
        )
        // A quota refusal (also 413) concerns the whole selection: it still aborts the batch.
        const skippable = xhr.status === 400 || code === 'upload-too-large'
        // A skipped file is reported once, in the selection's summary (uploadImportFiles).
        if (!skippable) {
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
        }
        reject(new UploadRefusedError(message, skippable))
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
        const message = `${file.name}: invalid upload response: ${error instanceof Error ? error.message : String(error)}`
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
      const message = `${file.name}: upload failed (network error)`
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

/** Best effort, one at a time: a folder selection can hold thousands of refs. */
async function discardUploads(refs: readonly string[]): Promise<void> {
  for (const ref of refs) {
    if (!ref.startsWith('web-upload:')) continue
    await fetch(`${API_BASE}/import/upload?ref=${encodeURIComponent(ref)}`, {
      method: 'DELETE',
      credentials: 'include'
    }).catch(() => undefined)
  }
}

/** True when the name ends with one of the `accept` suffixes (a folder pick ignores `accept`). */
function isAcceptedName(name: string, accept: string): boolean {
  const lower = name.toLowerCase()
  return accept.split(',').some((suffix) => lower.endsWith(suffix.trim().toLowerCase()))
}

export async function uploadImportFiles(
  picked: readonly File[],
  accept?: string
): Promise<UploadedFileRef[]> {
  const accepted = (file: File): boolean =>
    accept === undefined || isAcceptedName(file.name, accept)
  const files = picked.filter(accepted)
  const skipped = picked
    .filter((file) => !accepted(file))
    .map((file) => `${file.name}: ${UPLOAD_CONFIG.NOT_ACCEPTED_REASON}`)
  const uploaded: UploadedFileRef[] = []
  try {
    for (let index = 0; index < files.length; index++) {
      try {
        uploaded.push(await uploadImportFileWithProgress(files[index], index, files.length))
      } catch (error) {
        // One stray file must not block the good ones; the summary below names it.
        if (!(error instanceof UploadRefusedError) || !error.skippable) throw error
        skipped.push(error.message)
      }
    }
  } catch (error) {
    // Refused or cancelled part-way: nothing will import the files already
    // staged, and left alone they count against the per-user cap for 24 h.
    void discardUploads(uploaded.map((file) => file.ref))
    throw error
  }
  if (skipped.length > 0) {
    const message = skippedUploadsSummary(skipped)
    // Sent even when every file was refused: it ends the upload status for every picker.
    dispatchUploadEvent({
      status: 'skipped',
      fileName: '',
      fileIndex: files.length - 1,
      totalFiles: files.length,
      loadedBytes: 0,
      totalBytes: null,
      percent: null,
      message
    })
    if (uploaded.length === 0) throw new Error(message)
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
  return (await uploadImportFiles(files, params.accept)).map((file) => file.ref)
}
