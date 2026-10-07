// @vitest-environment happy-dom
/**
 * useVepEnrichment: on-demand VEP, MyVariant and SpliceAI lookups for one
 * variant, read from the query cache.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { useVepEnrichment as useEnrichment } from '../../../src/renderer/src/composables/useVepEnrichment'
import { installCapabilities } from '../helpers/capabilities'
import { createQueryPinia, withQueries } from '../helpers/with-queries'

vi.mock('../../../src/renderer/src/services/LogService', () => ({
  logService: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

const mockVepFetch = vi.fn()
const mockMyvariantFetch = vi.fn()
const mockSpliceaiFetch = vi.fn()

const successVepResult = {
  success: true,
  data: [{ most_severe_consequence: 'missense_variant', colocated_variants: [] }],
  preferredTranscript: null,
  allTranscripts: [],
  cacheInfo: { cached: false, cachedAt: null }
}

const successMyvariantResult = {
  success: true,
  scores: { revel_score: 0.85, alphamissense_score: 0.9 }
}

const successSpliceaiResult = {
  success: true,
  scores: { max_delta: 0.3 }
}

const ipcError = {
  code: 'UNKNOWN' as const,
  message: 'transport failed',
  userMessage: 'Transport failed'
}

describe('useVepEnrichment', () => {
  const hosts: Array<{ unmount: () => void }> = []

  function useVepEnrichment() {
    const host = withQueries(useEnrichment)
    hosts.push(host)
    return host.result
  }

  afterEach(() => hosts.splice(0).forEach((host) => host.unmount()))

  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(window, {
      api: {
        vep: { fetch: mockVepFetch },
        myvariant: { fetch: mockMyvariantFetch },
        spliceai: { fetch: mockSpliceaiFetch }
      }
    })
    mockVepFetch.mockResolvedValue(successVepResult)
    mockMyvariantFetch.mockResolvedValue(successMyvariantResult)
    mockSpliceaiFetch.mockResolvedValue(successSpliceaiResult)
  })

  it('clearData resets all enrichment state', async () => {
    const enrichment = useVepEnrichment()

    await enrichment.fetchVep('1', 12345, 'A', 'G')

    expect(enrichment.mostSevereConsequence.value).toBe('missense_variant')
    expect(enrichment.revelScore.value).toBe(0.85)
    expect(enrichment.spliceaiMaxDelta.value).toBe(0.3)

    enrichment.clearData()
    await flushPromises()

    expect(enrichment.vepData.value).toBeNull()
    expect(enrichment.myvariantData.value).toBeNull()
    expect(enrichment.spliceaiData.value).toBeNull()
    expect(enrichment.mostSevereConsequence.value).toBeNull()
    expect(enrichment.revelScore.value).toBeNull()
    expect(enrichment.spliceaiMaxDelta.value).toBeNull()
    expect(enrichment.vepLoading.value).toBe(false)
  })

  it('discards stale results when clearData is called during fetch', async () => {
    // Create a delayed VEP response that resolves after clearData
    let resolveVep: (value: unknown) => void
    mockVepFetch.mockReturnValue(
      new Promise((resolve) => {
        resolveVep = resolve
      })
    )
    mockMyvariantFetch.mockResolvedValue(successMyvariantResult)
    mockSpliceaiFetch.mockResolvedValue(successSpliceaiResult)

    const enrichment = useVepEnrichment()

    // Start fetching for variant A
    const fetchPromise = enrichment.fetchVep('1', 100, 'A', 'G')

    // Simulate variant switch: clearData is called before fetch completes
    enrichment.clearData()

    // Now the old fetch resolves with variant A's data
    resolveVep!(successVepResult)
    await fetchPromise

    // Stale results should be discarded — data stays null
    expect(enrichment.vepData.value).toBeNull()
    expect(enrichment.mostSevereConsequence.value).toBeNull()
  })

  it('discards stale results when a new fetchVep is called', async () => {
    let resolveFirstVep: (value: unknown) => void
    const firstFetchPromise = new Promise((resolve) => {
      resolveFirstVep = resolve
    })

    // First call returns a pending promise
    mockVepFetch.mockReturnValueOnce(firstFetchPromise)

    const enrichment = useVepEnrichment()

    // Start fetch for variant A
    const fetchA = enrichment.fetchVep('1', 100, 'A', 'G')
    await flushPromises()

    // Start fetch for variant B (this bumps the generation)
    mockVepFetch.mockResolvedValueOnce({
      success: true,
      data: [{ most_severe_consequence: 'synonymous_variant', colocated_variants: [] }],
      preferredTranscript: null,
      allTranscripts: [],
      cacheInfo: { cached: false, cachedAt: null }
    })
    const fetchB = enrichment.fetchVep('2', 200, 'C', 'T')

    // Resolve first fetch (variant A) — should be discarded
    resolveFirstVep!(successVepResult)
    await fetchA
    await fetchB

    // Should have variant B's data, not variant A's
    expect(enrichment.mostSevereConsequence.value).toBe('synonymous_variant')
  })

  it('clears loading flags when fulfilled IPC results unwrap to errors', async () => {
    mockVepFetch.mockResolvedValue(ipcError)
    mockMyvariantFetch.mockResolvedValue(ipcError)
    mockSpliceaiFetch.mockResolvedValue(ipcError)

    const enrichment = useVepEnrichment()

    await enrichment.fetchVep('1', 12345, 'A', 'G')

    expect(enrichment.vepLoading.value).toBe(false)
    expect(enrichment.myvariantLoading.value).toBe(false)
    expect(enrichment.spliceaiLoading.value).toBe(false)
    expect(enrichment.vepError.value).toBe('Transport failed')
    expect(enrichment.vepData.value).toBeNull()
    expect(enrichment.myvariantData.value).toBeNull()
    expect(enrichment.spliceaiData.value).toBeNull()
  })

  it('fetches nothing until asked, and each provider once per request', async () => {
    const enrichment = useVepEnrichment()
    await flushPromises()
    expect(mockVepFetch).not.toHaveBeenCalled()

    await enrichment.fetchVep('1', 12345, 'A', 'G')
    expect(mockVepFetch).toHaveBeenCalledExactlyOnceWith('1', 12345, 'A', 'G')
    expect(mockMyvariantFetch).toHaveBeenCalledTimes(1)
    expect(mockSpliceaiFetch).toHaveBeenCalledTimes(1)
  })

  it('asks the main process again when the same variant is requested again', async () => {
    const enrichment = useVepEnrichment()
    await enrichment.fetchVep('1', 12345, 'A', 'G')
    enrichment.clearData()
    await flushPromises()

    await enrichment.fetchVep('1', 12345, 'A', 'G')
    expect(mockVepFetch).toHaveBeenCalledTimes(2)
  })

  it('reports the VEP service error and keeps the offline flag', async () => {
    mockVepFetch.mockResolvedValue({ success: false, error: 'No network', offline: true })
    const enrichment = useVepEnrichment()
    await enrichment.fetchVep('1', 12345, 'A', 'G')

    expect(enrichment.vepError.value).toBe('No network')
    expect(enrichment.isOffline.value).toBe(true)
    expect(enrichment.revelScore.value).toBe(0.85)
  })

  it('web with the lookups off: no provider is called and VEP gives the reason', async () => {
    const pinia = createQueryPinia()
    installCapabilities({ runtime: 'web' })
    const host = withQueries(useEnrichment, pinia)
    hosts.push(host)

    await host.result.fetchVep('1', 12345, 'A', 'G')

    expect(mockVepFetch).not.toHaveBeenCalled()
    expect(mockMyvariantFetch).not.toHaveBeenCalled()
    expect(mockSpliceaiFetch).not.toHaveBeenCalled()
    expect(host.result.vepError.value).toEqual(expect.any(String))
    expect(host.result.isLoading.value).toBe(false)
  })
})
