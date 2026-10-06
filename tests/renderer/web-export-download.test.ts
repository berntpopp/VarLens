import { afterEach, describe, expect, test, vi } from 'vitest'

import { createApi } from '../../src/web/client/api'
import { prepareAndDownload } from '../../src/web/client/export-download'
import { ErrorCode } from '../../src/shared/types/errors'

const PREPARED = { downloadPath: 'download/abc123abc123abc123ab.1700000000000.sig', expiresAt: 1 }

function captureAnchorClicks(): { clicks: HTMLAnchorElement[] } {
  const clicks: HTMLAnchorElement[] = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement
  ) {
    clicks.push(this)
  })
  return { clicks }
}

/** fetch stub answering POST /api/export/prepareDownload with `body`. */
function stubPrepare(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function sentRequest(fetchMock: ReturnType<typeof vi.fn>): { url: string; args: unknown[] } {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
  return { url, args: (JSON.parse(String(init.body)) as { args: unknown[] }).args }
}

describe('web export download (window.api.export in web mode)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  test('variant export prepares a grant over RPC, then downloads it by navigation', async () => {
    const fetchMock = stubPrepare(PREPARED)
    const { clicks } = captureAnchorClicks()

    // Large filters travel in the POST body: no URL-length limit any more.
    const filters = { consequences: ['HIGH'], gene_symbol: 'G'.repeat(20_000) }
    const result = await createApi().export.variants(12, filters as never, 'Case A/1')

    expect(result).toEqual({ success: true, filePath: 'Case_A_1_variants.csv' })
    const sent = sentRequest(fetchMock)
    expect(sent.url).toBe('/api/export/prepareDownload')
    expect(sent.args).toEqual([
      { kind: 'variants', format: 'csv', caseId: 12, caseName: 'Case A/1', filters }
    ])
    expect(clicks).toHaveLength(1)
    expect(clicks[0].download).toBe('Case_A_1_variants.csv')
    expect(new URL(clicks[0].href, 'http://localhost').pathname).toBe(
      `/api/${PREPARED.downloadPath}`
    )
    expect(document.querySelectorAll('a[download]')).toHaveLength(0)
  })

  test('cohort export honours the xlsx format option', async () => {
    const fetchMock = stubPrepare(PREPARED)
    const { clicks } = captureAnchorClicks()
    const params = { gene_symbol: 'TP53' }

    const result = (await createApi().export.cohort(params as never, { format: 'xlsx' })) as {
      filePath: string
    }

    expect(result.filePath).toMatch(/^cohort_variants_\d{4}-\d{2}-\d{2}\.xlsx$/)
    expect(sentRequest(fetchMock).args).toEqual([{ kind: 'cohort', format: 'xlsx', params }])
    expect(clicks).toHaveLength(1)
  })

  test('a refused prepare (viewer role) returns the IPC error and starts no download', async () => {
    const refusal = {
      code: 'UNKNOWN',
      message: 'role-required',
      userMessage: 'Your role does not allow this action (requires analyst).'
    }
    stubPrepare(refusal, 403)
    const { clicks } = captureAnchorClicks()

    await expect(createApi().export.variants(1, {} as never, 'x')).resolves.toEqual(refusal)
    expect(clicks).toHaveLength(0)
  })

  test('panels.exportBed downloads the BED artifact', async () => {
    const fetchMock = stubPrepare(PREPARED)
    const { clicks } = captureAnchorClicks()

    await expect(createApi().panels.exportBed(4, 'GRCh38', 50)).resolves.toEqual({
      success: true,
      path: 'panel_4_GRCh38.bed'
    })
    expect(sentRequest(fetchMock).args).toEqual([
      { kind: 'panel-bed', panelId: 4, assembly: 'GRCh38', paddingBp: 50 }
    ])
    expect(clicks).toHaveLength(1)
  })

  test('a malformed prepare answer is reported, not downloaded', async () => {
    const invoke = vi.fn(async () => ({ downloadPath: '../../etc/passwd' }))
    const { clicks } = captureAnchorClicks()
    await expect(prepareAndDownload({ kind: 'cohort' }, 'x.csv', invoke)).resolves.toMatchObject({
      success: false
    })
    expect(clicks).toHaveLength(0)
  })

  test('revealInFolder is desktop-only: refused locally without a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(createApi().export.revealInFolder('x.csv')).resolves.toMatchObject({
      code: ErrorCode.UNSUPPORTED_RUNTIME
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('cancel is a local no-op: the browser download manager owns the stream', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(createApi().export.cancel()).resolves.toEqual({ cancelled: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
