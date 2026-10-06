/**
 * Web-mode export delivery: `export.variants`, `export.cohort` and
 * `panels.exportBed` (adapters wired into the typed client by local-api.ts).
 *
 * Desktop export opens a native save dialog and writes a file. In the
 * browser the flow is two steps (server: src/web/server/routes/export-download.ts):
 *
 *   1. `POST /api/export/prepareDownload` — an ordinary RPC POST (CSRF-gated,
 *      role-checked, audited) that returns a short-lived, single-use download
 *      path bound to this session's user.
 *   2. A hidden `<a download>` navigates to that path. The browser's download
 *      manager consumes the streamed CSV / XLSX / BED response directly, so a
 *      large export never sits in page memory (no fetch-to-blob) and the SPA
 *      never navigates away. The filters travel in the POST body, so there is
 *      no URL-length limit.
 *
 * `ExportResult.filePath` reports the suggested file name; there is no
 * server-side path to reveal (`revealInFolder` is desktop-only in the parity
 * manifest). Cancelling the download in the browser closes the socket, which
 * ends the server-side query stream.
 */
import type { ExportOptions, ExportResult } from '../../shared/ipc/domains/export'
import { isIpcError, type IpcResult } from '../../shared/types/errors'
import { API_BASE, httpInvoke } from './transport'

type Invoke = (domain: string, method: string, args: unknown[]) => Promise<unknown>

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
 * Prepare a grant for `request` and start the browser download. An IPC
 * error (e.g. 403 role-required) is returned unchanged so `unwrapIpcResult`
 * at the call site reports it.
 */
export async function prepareAndDownload(
  request: Record<string, unknown>,
  fileName: string,
  invoke: Invoke = httpInvoke,
  apiBase: string = API_BASE
): Promise<IpcResult<ExportResult>> {
  const prepared = await invoke('export', 'prepareDownload', [request])
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
  caseId: number,
  filters: unknown,
  caseName: string,
  options?: ExportOptions,
  invoke?: Invoke
): Promise<IpcResult<ExportResult>> {
  const format = formatOf(options)
  return prepareAndDownload(
    { kind: 'variants', format, caseId, caseName, filters: filters ?? {} },
    `${exportFileStem(caseName)}_variants.${format}`,
    invoke
  )
}

export function exportCohortDownload(
  params: unknown,
  options?: ExportOptions,
  invoke?: Invoke
): Promise<IpcResult<ExportResult>> {
  const format = formatOf(options)
  return prepareAndDownload(
    { kind: 'cohort', format, params: params ?? {} },
    `cohort_variants_${new Date().toISOString().slice(0, 10)}.${format}`,
    invoke
  )
}

/** `panels.exportBed` as a browser download (panel tooling itself is RPC). */
export async function exportPanelBedDownload(
  panelId: number,
  assembly: string,
  paddingBp: number,
  invoke?: Invoke
): Promise<IpcResult<{ success: boolean; path?: string }>> {
  const result = await prepareAndDownload(
    { kind: 'panel-bed', panelId, assembly, paddingBp },
    `panel_${panelId}_${assembly}.bed`,
    invoke
  )
  if (isIpcError(result)) return result
  return result.success ? { success: true, path: result.filePath } : result
}
