import { afterEach, describe, expect, test, vi } from 'vitest'

import { buildExportApi, buildPanelsApi } from '../../src/web/client/export-download'

interface ExportApi {
  variants: (
    caseId: number,
    filters: unknown,
    caseName: string,
    options?: { format?: 'csv' | 'xlsx' }
  ) => Promise<unknown>
  cohort: (params: unknown, options?: { format?: 'csv' | 'xlsx' }) => Promise<unknown>
  revealInFolder: (filePath: string) => Promise<unknown>
  cancel: () => Promise<unknown>
  onProgress: (callback: (progress: unknown) => void) => () => void
  other: unknown
}

function captureAnchorClicks(): { clicks: HTMLAnchorElement[] } {
  const clicks: HTMLAnchorElement[] = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement
  ) {
    clicks.push(this)
  })
  return { clicks }
}

const PREPARED = { downloadPath: 'download/abc123abc123abc123ab.1700000000000.sig', expiresAt: 1 }

describe('web export download (window.api.export in web mode)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('variant export prepares a grant over RPC, then downloads it by navigation', async () => {
    const prepareDownload = vi.fn().mockResolvedValue(PREPARED)
    const api = buildExportApi({ prepareDownload }) as ExportApi
    const { clicks } = captureAnchorClicks()

    const filters = { consequences: ['HIGH'], gene_symbol: 'G'.repeat(20_000) }
    const result = await api.variants(12, filters, 'Case A/1')

    expect(result).toEqual({ success: true, filePath: 'Case_A_1_variants.csv' })
    // Filters travel in the POST body: no URL-length limit any more.
    expect(prepareDownload).toHaveBeenCalledWith({
      kind: 'variants',
      format: 'csv',
      caseId: 12,
      caseName: 'Case A/1',
      filters
    })
    expect(clicks).toHaveLength(1)
    expect(clicks[0].download).toBe('Case_A_1_variants.csv')
    expect(new URL(clicks[0].href, 'http://localhost').pathname).toBe(
      `/api/${PREPARED.downloadPath}`
    )
    expect(document.querySelectorAll('a[download]')).toHaveLength(0)
  })

  test('cohort export honours the xlsx format option', async () => {
    const prepareDownload = vi.fn().mockResolvedValue(PREPARED)
    const api = buildExportApi({ prepareDownload }) as ExportApi
    const { clicks } = captureAnchorClicks()

    const params = { gene_symbol: 'TP53' }
    const result = (await api.cohort(params, { format: 'xlsx' })) as { filePath: string }

    expect(result.filePath).toMatch(/^cohort_variants_\d{4}-\d{2}-\d{2}\.xlsx$/)
    expect(prepareDownload).toHaveBeenCalledWith({ kind: 'cohort', format: 'xlsx', params })
    expect(clicks).toHaveLength(1)
  })

  test('a refused prepare (e.g. viewer role) returns the IPC error and starts no download', async () => {
    const refusal = {
      code: 'UNKNOWN',
      message: 'role-required',
      userMessage: 'Your role does not allow this action (requires analyst).'
    }
    const api = buildExportApi({ prepareDownload: vi.fn().mockResolvedValue(refusal) }) as ExportApi
    const { clicks } = captureAnchorClicks()

    await expect(api.variants(1, {}, 'x')).resolves.toEqual(refusal)
    expect(clicks).toHaveLength(0)
  })

  test('panels.exportBed downloads the BED artifact and other panel methods use RPC', async () => {
    const prepareDownload = vi.fn().mockResolvedValue(PREPARED)
    const list = vi.fn()
    const panels = buildPanelsApi({ list }, { prepareDownload }) as {
      exportBed: (id: number, assembly: string, padding: number) => Promise<unknown>
      list: unknown
    }
    const { clicks } = captureAnchorClicks()

    await expect(panels.exportBed(4, 'GRCh38', 50)).resolves.toEqual({
      success: true,
      path: 'panel_4_GRCh38.bed'
    })
    expect(prepareDownload).toHaveBeenCalledWith({
      kind: 'panel-bed',
      panelId: 4,
      assembly: 'GRCh38',
      paddingBp: 50
    })
    expect(clicks).toHaveLength(1)
    expect(panels.list).toBe(list)
  })

  test('onProgress subscribes to the export:progress push event', () => {
    const unsubscribe = vi.fn()
    const subscribe = vi.fn().mockReturnValue(unsubscribe)
    const api = buildExportApi({}, subscribe) as ExportApi
    const callback = vi.fn()

    expect(api.onProgress(callback)).toBe(unsubscribe)
    expect(subscribe).toHaveBeenCalledWith('export:progress', callback)
  })

  test('revealInFolder and cancel are local no-ops; other methods fall through to RPC', async () => {
    const other = vi.fn()
    const cancel = vi.fn()
    const api = buildExportApi({ other, cancel }) as ExportApi
    await expect(api.revealInFolder('x.csv')).resolves.toEqual({ success: false })
    await expect(api.cancel()).resolves.toEqual({ cancelled: false })
    expect(cancel).not.toHaveBeenCalled()
    expect(api.other).toBe(other)
  })
})
