/**
 * Web-mode `panels.exportBed` (manifest adapter `download`): a browser
 * download from GET /api/panels/export-bed (src/web/server/panel-bed-download.ts).
 * The server names the file via Content-Disposition, so the anchor's
 * `download` attribute is left empty. Wired in local-api.ts.
 */
import { triggerBrowserDownload } from './export-download'

const API_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api`

export function buildPanelBedUrl(
  panelId: number,
  assembly: string,
  paddingBp: number,
  apiBase: string = API_BASE
): string {
  const query = new URLSearchParams({
    panelId: String(panelId),
    assembly,
    paddingBp: String(paddingBp)
  })
  return `${apiBase}/panels/export-bed?${query.toString()}`
}

export function exportPanelBedDownload(
  panelId: number,
  assembly: string,
  paddingBp: number
): Promise<{ success: boolean; path?: string }> {
  triggerBrowserDownload(buildPanelBedUrl(panelId, assembly, paddingBp), '')
  return Promise.resolve({ success: true })
}
