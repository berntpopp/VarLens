import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PanelAppClient } from '../../../src/main/services/api/PanelAppClient'
import { stalledBody } from './api/stalled-fetch'

// Mock MainLogger
vi.mock('../../../src/main/services/MainLogger', () => ({
  mainLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

// A short lookup timeout so the stalled-body test finishes quickly
vi.mock('../../../src/shared/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/shared/config')>()
  return { ...actual, API_CONFIG: { ...actual.API_CONFIG, LOOKUP_TIMEOUT_MS: 50 } }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePanelListResponse(panels: Array<Record<string, unknown>>) {
  return {
    count: panels.length,
    next: null,
    results: panels
  }
}

function makeRawPanel(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    name: 'Epilepsy panel',
    version: '4.7',
    disease_group: 'Neurology',
    disease_sub_group: 'Epilepsy',
    status: 'public',
    relevant_disorders: ['Epilepsy'],
    stats: { number_of_genes: 42 },
    types: [{ name: 'Gene Panel', slug: 'gene-panel' }],
    ...overrides
  }
}

function makeFullPanel(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    name: 'Epilepsy panel',
    version: '4.7',
    stats: { number_of_genes: 2 },
    genes: [
      {
        gene_data: {
          gene_symbol: 'SCN1A',
          hgnc_id: 'HGNC:10585',
          gene_name: 'sodium voltage-gated channel alpha subunit 1'
        },
        confidence_level: '3',
        mode_of_inheritance: 'MONOALLELIC',
        phenotypes: ['Dravet syndrome']
      },
      {
        gene_data: {
          gene_symbol: 'SCN2A',
          hgnc_id: 'HGNC:10588',
          gene_name: 'sodium voltage-gated channel alpha subunit 2'
        },
        confidence_level: '2',
        mode_of_inheritance: 'MONOALLELIC',
        phenotypes: ['Epileptic encephalopathy']
      }
    ],
    ...overrides
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PanelAppClient', () => {
  let client: PanelAppClient
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    client = new PanelAppClient()
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  // -----------------------------------------------------------------------
  // searchPanels
  // -----------------------------------------------------------------------

  describe('searchPanels', () => {
    it('searches UK region and tags results', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(makePanelListResponse([makeRawPanel()])), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )

      const results = await client.searchPanels('epilepsy', 'uk')

      expect(results).toHaveLength(1)
      expect(results[0].region).toBe('uk')
      expect(results[0].name).toBe('Epilepsy panel')
      expect(results[0].stats.number_of_genes).toBe(42)

      // Verify URL targets UK endpoint
      const calledUrl = fetchSpy.mock.calls[0][0] as string
      expect(calledUrl).toContain('panelapp.genomicsengland.co.uk')
      expect(calledUrl).toContain('name=epilepsy')
    })

    it('keeps the other region when one region stalls mid-body', async () => {
      fetchSpy.mockImplementation(async (url, init) =>
        String(url).includes('genomicsengland')
          ? stalledBody(init)
          : new Response(JSON.stringify(makePanelListResponse([makeRawPanel({ id: 2 })])))
      )

      const results = await client.searchPanels('epilepsy', 'both')

      expect(results.map((r) => r.region)).toEqual(['aus'])
    })

    it('searches AUS region', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(makePanelListResponse([makeRawPanel({ id: 2 })])), {
          status: 200
        })
      )

      const results = await client.searchPanels('cardiac', 'aus')

      expect(results).toHaveLength(1)
      expect(results[0].region).toBe('aus')

      const calledUrl = fetchSpy.mock.calls[0][0] as string
      expect(calledUrl).toContain('panelapp-aus.org')
    })

    it('searches both regions in parallel and merges results', async () => {
      fetchSpy.mockImplementation(async (url) => {
        const urlStr = typeof url === 'string' ? url : (url as Request).url
        if (urlStr.includes('genomicsengland')) {
          return new Response(JSON.stringify(makePanelListResponse([makeRawPanel({ id: 1 })])), {
            status: 200
          })
        }
        return new Response(JSON.stringify(makePanelListResponse([makeRawPanel({ id: 99 })])), {
          status: 200
        })
      })

      const results = await client.searchPanels('test', 'both')

      expect(results).toHaveLength(2)
      expect(results[0].region).toBe('uk')
      expect(results[1].region).toBe('aus')
      expect(fetchSpy).toHaveBeenCalledTimes(2)
    })

    it('returns empty array on API error for a region', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('Server Error', { status: 500 }))

      const results = await client.searchPanels('test', 'uk')
      expect(results).toEqual([])
    })

    it('returns empty array on network failure', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('fetch failed'))

      const results = await client.searchPanels('test', 'uk')
      expect(results).toEqual([])
    })

    it('handles empty results', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(makePanelListResponse([])), { status: 200 })
      )

      const results = await client.searchPanels('nonexistent', 'uk')
      expect(results).toEqual([])
    })
  })

  // -----------------------------------------------------------------------
  // getPanel
  // -----------------------------------------------------------------------

  describe('getPanel', () => {
    it('fetches full panel with genes', async () => {
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(makeFullPanel()), { status: 200 }))

      const panel = await client.getPanel(1, 'uk')

      expect(panel.id).toBe(1)
      expect(panel.name).toBe('Epilepsy panel')
      expect(panel.region).toBe('uk')
      expect(panel.genes).toHaveLength(2)
      expect(panel.genes[0].gene_data.gene_symbol).toBe('SCN1A')
      expect(panel.genes[0].confidence_level).toBe('3')
      expect(panel.genes[1].gene_data.gene_symbol).toBe('SCN2A')
    })

    it('throws on API error', async () => {
      fetchSpy.mockResolvedValueOnce(new Response('Not Found', { status: 404 }))

      await expect(client.getPanel(999, 'uk')).rejects.toThrow('PanelApp API error: 404')
    })

    it('handles panel with no genes', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(makeFullPanel({ genes: [] })), { status: 200 })
      )

      const panel = await client.getPanel(1, 'aus')
      expect(panel.genes).toEqual([])
      expect(panel.region).toBe('aus')
    })
  })

  it('times out a response whose body stalls after the headers', async () => {
    // Headers arrive, the body never does: the lookup must still end at the timeout.
    fetchSpy.mockImplementationOnce(async (_url, init) => stalledBody(init))

    await expect(client.getPanel(1, 'uk')).rejects.toThrow(/timeout|abort/i)
  })
})
