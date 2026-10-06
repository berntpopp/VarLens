/**
 * Web-mode `window.api.export`.
 *
 * Desktop export opens a native save dialog and writes a file. In the
 * browser the server streams the CSV as an attachment instead
 * (src/web/server/routes/export-download.ts); this module starts that
 * download with a hidden `<a download>` click. The browser's download
 * manager consumes the response directly, so a large export never sits
 * in page memory (no fetch-to-blob) and the SPA never navigates away.
 *
 * The returned `ExportResult` reports the download file name in
 * `filePath`; there is no server-side path to reveal (`revealInFolder` is
 * desktop-only in the parity manifest). local-api.ts wires these into the
 * typed web client.
 */
import type { ExportResult } from '../../shared/ipc/domains/export'

/**
 * Leave headroom under Node's default 16 KiB request-header limit, which
 * the request line counts against.
 */
export const MAX_EXPORT_URL_LENGTH = 12_000

const API_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api`

/** Same sanitisation as the server's Content-Disposition file name. */
function exportFileStem(caseName: string): string {
  return caseName.replace(/[^a-z0-9]/gi, '_')
}

export function buildVariantExportUrl(
  caseId: number,
  filters: unknown,
  caseName: string,
  apiBase: string = API_BASE
): string {
  const query = new URLSearchParams({
    caseId: String(caseId),
    caseName,
    filters: JSON.stringify(filters ?? {})
  })
  return `${apiBase}/export/variants/download?${query.toString()}`
}

export function buildCohortExportUrl(params: unknown, apiBase: string = API_BASE): string {
  const query = new URLSearchParams({ params: JSON.stringify(params ?? {}) })
  return `${apiBase}/export/cohort/download?${query.toString()}`
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

function startDownload(url: string, fileName: string): ExportResult {
  if (url.length > MAX_EXPORT_URL_LENGTH) {
    return {
      success: false,
      error: 'The active filters are too large to export. Narrow the filters and try again.'
    }
  }
  triggerBrowserDownload(url, fileName)
  return { success: true, filePath: fileName }
}

export function exportVariantsDownload(
  caseId: number,
  filters: unknown,
  caseName: string
): Promise<ExportResult> {
  const fileName = `${exportFileStem(caseName)}_variants.csv`
  return Promise.resolve(startDownload(buildVariantExportUrl(caseId, filters, caseName), fileName))
}

export function exportCohortDownload(params: unknown): Promise<ExportResult> {
  const fileName = `cohort_variants_${new Date().toISOString().slice(0, 10)}.csv`
  return Promise.resolve(startDownload(buildCohortExportUrl(params), fileName))
}
