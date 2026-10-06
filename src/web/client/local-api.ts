/**
 * Web-client implementations of every `adapter` method in the parity
 * manifest: browser upload pickers, streamed downloads, server-sent events and
 * pure client equivalents. Typed against `WindowAPI`, so a signature drift is a
 * compile error; tests/shared/ipc/web-client-coverage.test.ts checks that this
 * table covers exactly the manifest's adapter methods.
 */
import type { WindowAPI } from '../../shared/types/api'
import { ALLOWED_DOMAINS } from '../../shared/config/allowed-domains'
import { isIpcError } from '../../shared/types/errors'
import {
  exportCohortDownload,
  exportPanelBedDownload,
  exportVariantsDownload
} from './export-download'
import { subscribeWebEvent } from './sse'
import { httpInvoke } from './transport'
import { pickAndUploadFiles, uploadImportFiles } from './uploads'

declare const __APP_VERSION__: string

export type LocalApi = { readonly [D in keyof WindowAPI]?: Partial<WindowAPI[D]> }

const IMPORT_ACCEPT = '.vcf,.vcf.gz,.json,.json.gz,.gz'

// ---------------------------------------------------------------------------
// shell: same rules as src/main/utils/url-validation.ts (https + allowlist,
// plus the user's external-link domains from shell.updateDomains).
// ---------------------------------------------------------------------------

let userDomains: string[] = []

function isValidHostname(hostname: string): boolean {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(hostname)
}

function isDomainAllowed(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return [...ALLOWED_DOMAINS, ...userDomains].some(
    (domain) => normalized === domain || normalized.endsWith(`.${domain}`)
  )
}

export function isUrlSafeForExternal(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && isDomainAllowed(parsed.hostname)
  } catch {
    return false
  }
}

const shell: WindowAPI['shell'] = {
  openExternal: (url) => {
    if (!isUrlSafeForExternal(url)) {
      return Promise.resolve({ success: false, error: 'URL not allowed' })
    }
    window.open(url, '_blank', 'noopener,noreferrer')
    return Promise.resolve({ success: true })
  },
  updateDomains: (domains) => {
    userDomains = Array.isArray(domains)
      ? domains
          .slice(0, 100)
          .filter((domain) => typeof domain === 'string' && isValidHostname(domain))
          .map((domain) => domain.toLowerCase())
      : []
    return Promise.resolve()
  }
}

// ---------------------------------------------------------------------------
// Upload pickers
// ---------------------------------------------------------------------------

async function pickOne(accept: string): Promise<string | null> {
  const refs = await pickAndUploadFiles({ multiple: false, accept })
  return refs[0] ?? null
}

const importApi: Partial<WindowAPI['import']> = {
  onProgress: (callback) => subscribeWebEvent('import:progress', callback),
  selectFile: () => pickOne(IMPORT_ACCEPT),
  selectFiles: () => pickAndUploadFiles({ multiple: true, accept: IMPORT_ACCEPT }),
  selectBedFile: () => pickOne('.bed,.bed.gz,.gz'),
  enrollDroppedFiles: async (files) => (await uploadImportFiles(files)).map((file) => file.ref)
}

const batchImportApi: Partial<WindowAPI['batchImport']> = {
  onProgress: (callback) => subscribeWebEvent('batch-import:progress', callback),
  onComplete: (callback) => subscribeWebEvent('batch-import:complete', callback),
  selectFiles: () => pickAndUploadFiles({ multiple: true, accept: IMPORT_ACCEPT }),
  selectFolder: () =>
    pickAndUploadFiles({ multiple: true, directory: true, accept: IMPORT_ACCEPT }),
  selectZip: async () => {
    const filePath = await pickOne('.zip')
    if (filePath === null) return null
    const probe = await httpInvoke('batch-import', 'testZipPassword', [filePath, ''])
    if (isIpcError(probe)) return probe
    return { filePath, isEncrypted: !(probe as { success: boolean }).success }
  }
}

// ---------------------------------------------------------------------------
// Runtime services with a browser equivalent
// ---------------------------------------------------------------------------

export const LOCAL_API: LocalApi = {
  variants: {
    onAnnotationChanged: (callback) => subscribeWebEvent('variants:annotationChanged', callback)
  },
  import: importApi,
  batchImport: batchImportApi,
  cohort: {
    onSummaryRebuilt: (callback) => subscribeWebEvent('cohort:summaryRebuilt', callback)
  },
  jobs: {
    // `jobs:changed` is a push event (desktop IPC event / web SSE), never an RPC.
    onChanged: (callback) => subscribeWebEvent('jobs:changed', callback)
  },
  export: {
    // Streamed browser downloads (export-download.ts). The browser's download
    // manager owns a running export: cancelling it there closes the socket,
    // which ends the server-side query stream, so `cancel` has nothing to stop.
    variants: (caseId, filters, caseName, options) =>
      exportVariantsDownload(caseId, filters, caseName, options),
    cohort: (params, options) => exportCohortDownload(params, options),
    cancel: () => Promise.resolve({ cancelled: false }),
    onProgress: (callback) => subscribeWebEvent('export:progress', callback)
  },
  panels: {
    // Signed single-use BED download; the rest of panel tooling is RPC.
    exportBed: (panelId, assembly, paddingBp) =>
      exportPanelBedDownload(panelId, assembly, paddingBp)
  },
  shell,
  system: {
    getVersion: () => Promise.resolve({ app: __APP_VERSION__, electron: 'web' })
  },
  perf: {
    // Electron startup-perf milestones and the perf harness are desktop-only.
    reportInteractive: () => undefined,
    isEnabled: () => false
  }
}
