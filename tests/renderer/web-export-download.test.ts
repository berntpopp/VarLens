import { afterEach, describe, expect, test, vi } from 'vitest'

import { createApi } from '../../src/web/client/api'
import {
  buildCohortExportUrl,
  buildVariantExportUrl,
  MAX_EXPORT_URL_LENGTH
} from '../../src/web/client/export-download'
import { ErrorCode } from '../../src/shared/types/errors'

function exportApi() {
  return createApi().export
}

function captureAnchorClicks(): { clicks: HTMLAnchorElement[]; restore: () => void } {
  const clicks: HTMLAnchorElement[] = []
  const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement
  ) {
    clicks.push(this)
  })
  return { clicks, restore: () => spy.mockRestore() }
}

describe('web export download (window.api.export in web mode)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  test('variant export starts an anchor download of the streaming endpoint', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const api = exportApi()
    const { clicks } = captureAnchorClicks()

    const filters = { consequences: ['HIGH'], gnomad_af_max: 0.01 }
    const result = await api.variants(12, filters as never, 'Case A/1')

    expect(result).toEqual({ success: true, filePath: 'Case_A_1_variants.csv' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(clicks).toHaveLength(1)
    const anchor = clicks[0]
    expect(anchor.download).toBe('Case_A_1_variants.csv')
    const url = new URL(anchor.href, 'http://localhost')
    expect(url.pathname).toBe('/api/export/variants/download')
    expect(url.searchParams.get('caseId')).toBe('12')
    expect(url.searchParams.get('caseName')).toBe('Case A/1')
    expect(JSON.parse(url.searchParams.get('filters') ?? '')).toEqual(filters)
    // The anchor is transient: nothing is left in the DOM after the click.
    expect(document.querySelectorAll('a[download]')).toHaveLength(0)
  })

  test('cohort export starts an anchor download with the JSON params', async () => {
    const api = exportApi()
    const { clicks } = captureAnchorClicks()

    const params = { gene_symbol: 'TP53', consequences: ['HIGH'] }
    const result = (await api.cohort(params as never)) as { success: boolean; filePath: string }

    expect(result.success).toBe(true)
    expect(result.filePath).toMatch(/^cohort_variants_\d{4}-\d{2}-\d{2}\.csv$/)
    const url = new URL(clicks[0].href, 'http://localhost')
    expect(url.pathname).toBe('/api/export/cohort/download')
    expect(JSON.parse(url.searchParams.get('params') ?? '')).toEqual(params)
  })

  test('refuses filters that would overflow the request line instead of failing silently', async () => {
    const api = exportApi()
    const { clicks } = captureAnchorClicks()

    const result = await api.variants(
      1,
      { gene_symbol: 'G'.repeat(MAX_EXPORT_URL_LENGTH) } as never,
      'x'
    )

    expect(result).toMatchObject({ success: false })
    expect(clicks).toHaveLength(0)
  })

  test('revealInFolder is desktop-only: refused locally without a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(exportApi().revealInFolder('x.csv')).resolves.toMatchObject({
      code: ErrorCode.UNSUPPORTED_RUNTIME
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('cancel is a local no-op: the browser download manager owns the stream', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(exportApi().cancel()).resolves.toEqual({ cancelled: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('URL builders honour a sub-path API base', () => {
    expect(buildVariantExportUrl(1, {}, 'c', '/varlens/api')).toMatch(
      /^\/varlens\/api\/export\/variants\/download\?/
    )
    expect(buildCohortExportUrl({}, '/varlens/api')).toBe(
      '/varlens/api/export/cohort/download?params=%7B%7D'
    )
  })
})
