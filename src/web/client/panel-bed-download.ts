/**
 * Web-mode `window.api.panels`: BED export becomes a browser download from
 * GET /api/panels/export-bed (src/web/server/panel-bed-download.ts); every
 * other panels method stays RPC. The server names the file via
 * Content-Disposition, so the anchor's `download` attribute is left empty.
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

/** `rpc` is the generic dispatcher proxy for the `panels` domain. */
export function buildPanelsApi(rpc: Record<string, unknown>): unknown {
  return new Proxy(
    {},
    {
      get(_target, prop: string | symbol) {
        if (prop === 'exportBed') return exportPanelBedDownload
        return typeof prop === 'string' ? rpc[prop] : undefined
      }
    }
  )
}
