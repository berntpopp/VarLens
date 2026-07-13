/**
 * Web-mode `window.api`.
 *
 * Single Proxy that forwards `window.api.<domain>.<method>(...args)` to
 * `POST /api/<domain>/<method>` with `{ args }`, returning the parsed
 * JSON body. Typed as `WindowAPI` so renderer call sites stay identical
 * to the Electron build.
 *
 * Three behaviours the renderer relies on that don't map to plain RPC:
 *
 *   - Event subscribers. Import progress is bridged over server-sent
 *     events; unsupported event sources still receive a no-op
 *     unsubscribe so call sites don't crash.
 *   - `perf.isEnabled` / `perf.reportInteractive`. Synchronous
 *     boolean / fire-and-forget; stubbed locally.
 *   - `shell.openExternal`. Browser equivalent is a validated `window.open`.
 *
 * Everything else is RPC. The server dispatcher is what enforces which
 * methods actually exist; the Proxy is permissive on purpose.
 */
import type { WindowAPI } from '../../shared/types/api'
import type { UpdateStatus } from '../../shared/types/api'
import { isIpcError } from '../../shared/types/errors'
import { ALLOWED_DOMAINS } from '../../shared/config/allowed-domains'

declare const __APP_VERSION__: string

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

interface InvokeBody {
  args: unknown[]
}

interface UploadedFileRef {
  ref: string
  fileName: string
  size: number
}

let activeUpload: XMLHttpRequest | null = null
let uploadCancelListenerRegistered = false
let uploadCancelListenerTarget: Window | null = null
let sharedEventSource: EventSource | null = null
let sharedEventSourceSubscriberCount = 0

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
// share that prefix or reverse-proxy path routing won't match.
const API_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api`

function isDomainAllowed(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return ALLOWED_DOMAINS.some(
    (domain) => normalized === domain || normalized.endsWith(`.${domain}`)
  )
}

function isUrlSafeForExternal(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && isDomainAllowed(parsed.hostname)
  } catch {
    return false
  }
}

async function httpInvoke(domain: string, method: string, args: unknown[]): Promise<unknown> {
  const body: InvokeBody = { args }
  const res = await fetch(`${API_BASE}/${domain}/${method}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  // Server returns JSON for both success and application errors
  // (SerializableError). Non-2xx with non-JSON body is a transport
  // failure — surface it.
  const text = await res.text()
  if (!res.ok) {
    try {
      const parsed = JSON.parse(text) as unknown
      if (isIpcError(parsed)) return parsed
    } catch {
      // Throw below for non-JSON error responses.
    }
    throw new Error(`web rpc ${domain}.${method}: ${res.status} ${res.statusText}: ${text}`)
  }
  if (text === '') return undefined
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`web rpc ${domain}.${method}: ${res.status} ${res.statusText}: ${text}`)
  }
}

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

async function uploadImportFiles(files: readonly File[]): Promise<UploadedFileRef[]> {
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

async function pickAndUploadFiles(params: {
  multiple: boolean
  accept: string
  directory?: boolean
}): Promise<string[]> {
  const files = await pickFiles(params)
  return (await uploadImportFiles(files)).map((file) => file.ref)
}

const NOOP_UNSUBSCRIBE = (): void => {}

function getSharedEventSource(): EventSource | null {
  if (typeof EventSource === 'undefined') return null
  if (sharedEventSource === null) {
    sharedEventSource = new EventSource(`${API_BASE}/events`, { withCredentials: true })
  }
  return sharedEventSource
}

function subscribeWebEvent<T>(type: string, callback: (payload: T) => void): () => void {
  const source = getSharedEventSource()
  if (source === null) return NOOP_UNSUBSCRIBE

  const listener = (event: MessageEvent<string>): void => {
    callback(JSON.parse(event.data) as T)
  }
  source.addEventListener(type, listener as EventListener)
  sharedEventSourceSubscriberCount += 1

  let unsubscribed = false
  return () => {
    if (unsubscribed) return
    unsubscribed = true

    source.removeEventListener(type, listener as EventListener)
    sharedEventSourceSubscriberCount = Math.max(0, sharedEventSourceSubscriberCount - 1)
    if (sharedEventSourceSubscriberCount === 0 && sharedEventSource === source) {
      source.close()
      sharedEventSource = null
    }
  }
}

function buildDomainProxy(domain: string): unknown {
  return new Proxy(
    {},
    {
      get(_target, prop: string | symbol) {
        if (typeof prop !== 'string') return undefined
        // Event subscribers: window.api.<domain>.on*(callback) → no-op unsubscribe.
        if (prop.startsWith('on')) {
          return (..._args: unknown[]) => NOOP_UNSUBSCRIBE
        }
        return (...args: unknown[]) => httpInvoke(domain, prop, args)
      }
    }
  )
}

const PERF_API = {
  reportInteractive: () => undefined,
  getSnapshot: () => httpInvoke('perf', 'getSnapshot', []),
  resetSnapshot: () => httpInvoke('perf', 'resetSnapshot', []),
  isEnabled: () => false
}

const SHELL_API = {
  openExternal: (url: string) => {
    if (!isUrlSafeForExternal(url)) {
      return Promise.resolve({ success: false, error: 'URL not allowed' } as unknown)
    }
    window.open(url, '_blank', 'noopener,noreferrer')
    return Promise.resolve({ success: true } as unknown)
  },
  updateDomains: (_domains: string[]) => Promise.resolve(undefined)
}

function buildExportApi(): unknown {
  const rpc = buildDomainProxy('export') as Record<string, unknown>
  return new Proxy(
    {},
    {
      get(_target, prop: string | symbol) {
        if (prop === 'revealInFolder') {
          return () => Promise.resolve({ success: false })
        }
        return typeof prop === 'string' ? rpc[prop] : undefined
      }
    }
  )
}

const SYSTEM_API = {
  getVersion: () => Promise.resolve({ app: __APP_VERSION__, electron: 'web' }),
  getUserDataPath: () => Promise.resolve('web'),
  getCpuCount: () => Promise.resolve(navigator.hardwareConcurrency || 1),
  setWorkerThreads: (_count: number) => Promise.resolve(undefined),
  getWorkerThreads: () => Promise.resolve(0),
  getLogFilePath: () => Promise.resolve('')
}

const idleUpdateStatus: UpdateStatus = { state: 'idle' }

const UPDATER_API = {
  checkForUpdate: () => Promise.resolve(undefined),
  downloadUpdate: () => Promise.resolve(undefined),
  installUpdate: () => Promise.resolve(undefined),
  getStatus: () => Promise.resolve(idleUpdateStatus),
  onStatusChange: (_callback: (status: UpdateStatus) => void) => NOOP_UNSUBSCRIBE
}

function buildImportApi(): unknown {
  const rpc = buildDomainProxy('import') as Record<string, unknown>
  return new Proxy(
    {},
    {
      get(_target, prop: string | symbol) {
        if (prop === 'onProgress') {
          return (callback: (progress: unknown) => void) =>
            subscribeWebEvent('import:progress', callback)
        }
        if (prop === 'selectFile') {
          return async () => {
            const refs = await pickAndUploadFiles({
              multiple: false,
              accept: '.vcf,.vcf.gz,.json,.json.gz,.gz'
            })
            return refs[0] ?? null
          }
        }
        if (prop === 'selectFiles') {
          return () =>
            pickAndUploadFiles({
              multiple: true,
              accept: '.vcf,.vcf.gz,.json,.json.gz,.gz'
            })
        }
        if (prop === 'selectBedFile') {
          return async () => {
            const refs = await pickAndUploadFiles({ multiple: false, accept: '.bed,.bed.gz,.gz' })
            return refs[0] ?? null
          }
        }
        if (prop === 'enrollDroppedFiles') {
          return async (files: readonly File[]) =>
            (await uploadImportFiles(files)).map((file) => file.ref)
        }
        return typeof prop === 'string' ? rpc[prop] : undefined
      }
    }
  )
}

function buildBatchImportApi(): unknown {
  const rpc = buildDomainProxy('batch-import') as Record<string, unknown>
  return new Proxy(
    {},
    {
      get(_target, prop: string | symbol) {
        if (prop === 'onProgress') {
          return (callback: (progress: unknown) => void) =>
            subscribeWebEvent('batch-import:progress', callback)
        }
        if (prop === 'onComplete') {
          return (callback: (result: unknown) => void) =>
            subscribeWebEvent('batch-import:complete', callback)
        }
        if (prop === 'selectFiles') {
          return () =>
            pickAndUploadFiles({
              multiple: true,
              accept: '.vcf,.vcf.gz,.json,.json.gz,.gz'
            })
        }
        if (prop === 'selectFolder') {
          return () =>
            pickAndUploadFiles({
              multiple: true,
              directory: true,
              accept: '.vcf,.vcf.gz,.json,.json.gz,.gz'
            })
        }
        if (prop === 'selectZip') {
          return async () => {
            const refs = await pickAndUploadFiles({ multiple: false, accept: '.zip' })
            const filePath = refs[0]
            if (filePath === undefined) return null

            const passwordProbe = await httpInvoke('batch-import', 'testZipPassword', [
              filePath,
              ''
            ])
            if (isIpcError(passwordProbe)) return passwordProbe
            const isEncrypted = !(passwordProbe as { success: boolean }).success
            return { filePath, isEncrypted }
          }
        }
        return typeof prop === 'string' ? rpc[prop] : undefined
      }
    }
  )
}

function buildVariantsApi(): unknown {
  const rpc = buildDomainProxy('variants') as Record<string, unknown>
  return new Proxy(
    {},
    {
      get(_target, prop: string | symbol) {
        if (prop === 'onAnnotationChanged') {
          return (callback: (event: unknown) => void) =>
            subscribeWebEvent('variants:annotationChanged', callback)
        }
        return typeof prop === 'string' ? rpc[prop] : undefined
      }
    }
  )
}

function buildCohortApi(): unknown {
  const rpc = buildDomainProxy('cohort') as Record<string, unknown>
  return new Proxy(
    {},
    {
      get(_target, prop: string | symbol) {
        if (prop === 'onSummaryRebuilt') {
          return (callback: (status: unknown) => void) =>
            subscribeWebEvent('cohort:summaryRebuilt', callback)
        }
        return typeof prop === 'string' ? rpc[prop] : undefined
      }
    }
  )
}

const DOMAIN_OVERRIDES: Record<string, unknown> = {
  batchImport: buildBatchImportApi(),
  'batch-import': buildBatchImportApi(),
  cohort: buildCohortApi(),
  export: buildExportApi(),
  import: buildImportApi(),
  perf: PERF_API,
  shell: SHELL_API,
  system: SYSTEM_API,
  updater: UPDATER_API,
  variants: buildVariantsApi()
}

export function createApi(): WindowAPI {
  return new Proxy({} as WindowAPI, {
    get(_target, prop: string | symbol) {
      if (typeof prop !== 'string') return undefined
      if (prop in DOMAIN_OVERRIDES) return DOMAIN_OVERRIDES[prop]
      return buildDomainProxy(prop)
    }
  }) as WindowAPI
}
