// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useVepEnrichment } from '../../../src/renderer/src/composables/useVepEnrichment'

// Mock the API service
const mockVepFetch = vi.fn()
const mockMyvariantFetch = vi.fn()
const mockSpliceaiFetch = vi.fn()

vi.mock('../../../src/renderer/src/composables/useApiService', () => ({
  useApiService: () => ({
    api: {
      vep: { fetch: mockVepFetch },
      myvariant: { fetch: mockMyvariantFetch },
      spliceai: { fetch: mockSpliceaiFetch }
    }
  })
}))

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

describe('useVepEnrichment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
})
