/**
 * Web-mode `window.api.export` (and `panels.exportBed`).
 *
 * Desktop export opens a native save dialog and writes a file. In the
 * browser the flow is two steps (server: src/web/server/routes/export-download.ts):
 *
 *   1. `export.prepareDownload(request)` — an ordinary RPC POST (CSRF-gated,
 *      role-checked, audited) that returns a short-lived, single-use download
 *      path bound to this session's user.
 *   2. A hidden `<a download>` navigates to that path. The browser's download
 *      manager consumes the streamed CSV / XLSX / BED response directly, so a
 *      large export never sits in page memory (no fetch-to-blob) and the SPA
 *      never navigates away. The filters travel in the POST body, so there is
 *      no URL-length limit.
 *
 * `ExportResult.filePath` reports the suggested file name; there is no
 * server-side path to reveal, so `revealInFolder` reports `success: false`,
 * and `cancel` reports `cancelled: false` (cancel the download in the
 * browser, which closes the socket and ends the server-side query stream).
 * `onProgress` relays the server's `export:progress` SSE events.
 */
import type { ExportOptions, ExportProgress, ExportResult } from '../../shared/ipc/domains/export'
import { isIpcError } from '../../shared/types/errors'

type Rpc = Record<string, unknown>
type Subscribe = <T>(type: string, callback: (payload: T) => void) => () => void

const API_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api`

/** Same sanitisation as the server's Content-Disposition file name. */
function exportFileStem(caseName: string): string {
  return caseName.replace(/[^a-z0-9]/gi, '_')
}

export function triggerBrowserDownload(url: string, fileName: string): void {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  try {
    anchor.click()
  } finally {
    anchor.remove()
  }
}

interface PreparedDownload {
  downloadPath: string
  expiresAt: number
}

function isPrepared(value: unknown): value is PreparedDownload {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PreparedDownload).downloadPath === 'string' &&
    (value as PreparedDownload).downloadPath.startsWith('download/')
  )
}

/**
 * Prepare a grant for `request` and start the browser download. Returns the
 * IPC-style error unchanged so `unwrapIpcResult` at the call site reports it.
 */
export async function prepareAndDownload(
  rpc: Rpc,
  request: Record<string, unknown>,
  fileName: string,
  apiBase: string = API_BASE
): Promise<unknown> {
  const prepare = rpc.prepareDownload as (request: unknown) => Promise<unknown>
  const prepared = await prepare(request)
  if (isIpcError(prepared)) return prepared
  if (!isPrepared(prepared)) {
    return { success: false, error: 'The server did not return a download link.' }
  }
  triggerBrowserDownload(`${apiBase}/${prepared.downloadPath}`, fileName)
  return { success: true, filePath: fileName }
}

function formatOf(options: ExportOptions | undefined): 'csv' | 'xlsx' {
  return options?.format === 'xlsx' ? 'xlsx' : 'csv'
}

export function exportVariantsDownload(
  rpc: Rpc,
  caseId: number,
  filters: unknown,
  caseName: string,
  options?: ExportOptions
): Promise<unknown> {
  const format = formatOf(options)
  return prepareAndDownload(
    rpc,
    { kind: 'variants', format, caseId, caseName, filters: filters ?? {} },
    `${exportFileStem(caseName)}_variants.${format}`
  )
}

export function exportCohortDownload(
  rpc: Rpc,
  params: unknown,
  options?: ExportOptions
): Promise<unknown> {
  const format = formatOf(options)
  return prepareAndDownload(
    rpc,
    { kind: 'cohort', format, params: params ?? {} },
    `cohort_variants_${new Date().toISOString().slice(0, 10)}.${format}`
  )
}

/** `rpc` is the generic dispatcher proxy for the `export` domain. */
export function buildExportApi(rpc: Rpc, subscribe?: Subscribe): unknown {
  return new Proxy(
    {},
    {
      get(_target, prop: string | symbol) {
        if (prop === 'variants') {
          return (caseId: number, filters: unknown, caseName: string, options?: ExportOptions) =>
            exportVariantsDownload(rpc, caseId, filters, caseName, options)
        }
        if (prop === 'cohort') {
          return (params: unknown, options?: ExportOptions) =>
            exportCohortDownload(rpc, params, options)
        }
        if (prop === 'revealInFolder') {
          return () => Promise.resolve({ success: false })
        }
        if (prop === 'cancel') {
          return () => Promise.resolve({ cancelled: false })
        }
        if (prop === 'onProgress') {
          return (callback: (progress: ExportProgress) => void) =>
            subscribe === undefined ? () => undefined : subscribe('export:progress', callback)
        }
        return typeof prop === 'string' ? rpc[prop] : undefined
      }
    }
  )
}

/**
 * `panels` domain with `exportBed` delivered as a browser download. Panel
 * tooling itself (validation, PanelApp, StringDB) is served by the generic
 * RPC proxy; only the BED file delivery is web-specific.
 */
export function buildPanelsApi(panelsRpc: Rpc, exportRpc: Rpc): unknown {
  return new Proxy(
    {},
    {
      get(_target, prop: string | symbol) {
        if (prop === 'exportBed') {
          return async (panelId: number, assembly: string, paddingBp: number) => {
            const result = await prepareAndDownload(
              exportRpc,
              { kind: 'panel-bed', panelId, assembly, paddingBp },
              `panel_${panelId}_${assembly}.bed`
            )
            if (isIpcError(result)) return result
            const ok = (result as ExportResult).success === true
            return ok ? { success: true, path: (result as ExportResult).filePath } : result
          }
        }
        return typeof prop === 'string' ? panelsRpc[prop] : undefined
      }
    }
  )
}
