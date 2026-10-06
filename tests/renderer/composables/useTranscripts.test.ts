import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import { withSetup, flushPromises } from '../../utils/test-helpers'
import { createMockApi } from '../../utils/mock-api'
import { useTranscripts } from '@renderer/composables/useTranscripts'
import type {
  TranscriptAnnotation,
  TranscriptInsertRow
} from '../../../src/shared/types/transcript'
import { ErrorCode } from '../../../src/shared/types/errors'

describe('useTranscripts', () => {
  let app: { unmount: () => void }

  beforeEach(() => {
    window.api = createMockApi()
  })

  afterEach(() => {
    if (app) app.unmount()
  })

  it('loads transcripts when variantId is provided on initialization', async () => {
    const mockTranscripts: TranscriptAnnotation[] = [
      {
        id: 1,
        variant_id: 10,
        transcript_id: 'ENST000001',
        gene_symbol: 'BRCA1',
        is_selected: 1,
        is_canonical: 1
      }
    ]
    window.api.transcripts.list = vi.fn().mockResolvedValue(mockTranscripts)

    const variantId = ref<number | null>(10)
    const [result, appInstance] = withSetup(() => useTranscripts(variantId))
    app = appInstance

    await flushPromises()

    expect(window.api.transcripts.list).toHaveBeenCalledWith(10)
    expect(result.transcripts.value).toEqual(mockTranscripts)
    expect(result.loading.value).toBe(false)
    expect(result.error.value).toBeNull()
  })

  it('clears transcripts when variantId changes to null', async () => {
    const mockTranscripts: TranscriptAnnotation[] = [
      {
        id: 1,
        variant_id: 10,
        transcript_id: 'ENST000001',
        gene_symbol: 'BRCA1',
        is_selected: 1,
        is_canonical: 1
      }
    ]
    window.api.transcripts.list = vi.fn().mockResolvedValue(mockTranscripts)

    const variantId = ref<number | null>(10)
    const [result, appInstance] = withSetup(() => useTranscripts(variantId))
    app = appInstance

    await flushPromises()
    expect(result.transcripts.value).toEqual(mockTranscripts)

    variantId.value = null
    await flushPromises()

    expect(result.transcripts.value).toEqual([])
    expect(result.loading.value).toBe(false)
    expect(result.error.value).toBeNull()
  })

  it('discards stale response when out-of-order resolution occurs (Finding F11)', async () => {
    let resolveVariant1!: (value: TranscriptAnnotation[]) => void
    let resolveVariant2!: (value: TranscriptAnnotation[]) => void

    const promise1 = new Promise<TranscriptAnnotation[]>((resolve) => {
      resolveVariant1 = resolve
    })
    const promise2 = new Promise<TranscriptAnnotation[]>((resolve) => {
      resolveVariant2 = resolve
    })

    window.api.transcripts.list = vi.fn().mockImplementation((id: number) => {
      if (id === 1) return promise1
      if (id === 2) return promise2
      return Promise.resolve([])
    })

    const variantId = ref<number | null>(1)
    const [result, appInstance] = withSetup(() => useTranscripts(variantId))
    app = appInstance

    // Request 1 is in flight
    expect(result.loading.value).toBe(true)

    // User rapidly switches to variant 2 before variant 1 resolves
    variantId.value = 2
    await flushPromises()

    expect(result.loading.value).toBe(true)

    const transcripts1: TranscriptAnnotation[] = [
      {
        id: 1,
        variant_id: 1,
        transcript_id: 'ENST000001',
        gene_symbol: 'GENE1',
        is_selected: 1,
        is_canonical: 1
      }
    ]
    const transcripts2: TranscriptAnnotation[] = [
      {
        id: 2,
        variant_id: 2,
        transcript_id: 'ENST000002',
        gene_symbol: 'GENE2',
        is_selected: 1,
        is_canonical: 1
      }
    ]

    // Variant 1 resolves late (out of order)
    resolveVariant1(transcripts1)
    await flushPromises()

    // Stale variant 1 must be discarded and loading must remain true for variant 2
    expect(result.transcripts.value).toEqual([])
    expect(result.loading.value).toBe(true)

    // Variant 2 resolves
    resolveVariant2(transcripts2)
    await flushPromises()

    // Now variant 2 transcripts are populated and loading is complete
    expect(result.transcripts.value).toEqual(transcripts2)
    expect(result.loading.value).toBe(false)
  })

  it('discards stale error from superseded request', async () => {
    let rejectVariant1!: (reason: unknown) => void
    let resolveVariant2!: (value: TranscriptAnnotation[]) => void

    const promise1 = new Promise<TranscriptAnnotation[]>((_, reject) => {
      rejectVariant1 = reject
    })
    const promise2 = new Promise<TranscriptAnnotation[]>((resolve) => {
      resolveVariant2 = resolve
    })

    window.api.transcripts.list = vi.fn().mockImplementation((id: number) => {
      if (id === 1) return promise1
      if (id === 2) return promise2
      return Promise.resolve([])
    })

    const variantId = ref<number | null>(1)
    const [result, appInstance] = withSetup(() => useTranscripts(variantId))
    app = appInstance

    // Rapidly switch to variant 2
    variantId.value = 2
    await flushPromises()

    // Variant 1 fails
    rejectVariant1(new Error('Network error on variant 1'))
    await flushPromises()

    expect(result.error.value).toBeNull()
    expect(result.loading.value).toBe(true)

    const transcripts2: TranscriptAnnotation[] = [
      {
        id: 2,
        variant_id: 2,
        transcript_id: 'ENST000002',
        gene_symbol: 'GENE2',
        is_selected: 1,
        is_canonical: 1
      }
    ]
    resolveVariant2(transcripts2)
    await flushPromises()

    expect(result.error.value).toBeNull()
    expect(result.transcripts.value).toEqual(transcripts2)
    expect(result.loading.value).toBe(false)
  })

  it('handles IPC errors gracefully on active variant', async () => {
    window.api.transcripts.list = vi.fn().mockResolvedValue({
      code: ErrorCode.DB_ERROR,
      message: 'Database query failed',
      userMessage: 'Failed to retrieve transcripts'
    })

    const variantId = ref<number | null>(5)
    const [result, appInstance] = withSetup(() => useTranscripts(variantId))
    app = appInstance

    await flushPromises()

    expect(result.error.value).toBe('Failed to retrieve transcripts')
    expect(result.transcripts.value).toEqual([])
    expect(result.loading.value).toBe(false)
  })

  it('switches transcript and reloads updated transcripts', async () => {
    const initialTranscripts: TranscriptAnnotation[] = [
      {
        id: 1,
        variant_id: 10,
        transcript_id: 'ENST000001',
        gene_symbol: 'BRCA1',
        is_selected: 1,
        is_canonical: 1
      },
      {
        id: 2,
        variant_id: 10,
        transcript_id: 'ENST000002',
        gene_symbol: 'BRCA1',
        is_selected: 0,
        is_canonical: 0
      }
    ]
    const updatedTranscripts: TranscriptAnnotation[] = [
      {
        id: 1,
        variant_id: 10,
        transcript_id: 'ENST000001',
        gene_symbol: 'BRCA1',
        is_selected: 0,
        is_canonical: 1
      },
      {
        id: 2,
        variant_id: 10,
        transcript_id: 'ENST000002',
        gene_symbol: 'BRCA1',
        is_selected: 1,
        is_canonical: 0
      }
    ]

    window.api.transcripts.list = vi
      .fn()
      .mockResolvedValueOnce(initialTranscripts)
      .mockResolvedValueOnce(updatedTranscripts)
    window.api.transcripts.switch = vi.fn().mockResolvedValue(undefined)

    const variantId = ref<number | null>(10)
    const [result, appInstance] = withSetup(() => useTranscripts(variantId))
    app = appInstance

    await flushPromises()
    expect(result.transcripts.value).toEqual(initialTranscripts)

    const ok = await result.switchTranscript('ENST000002')
    expect(ok).toBe(true)
    expect(window.api.transcripts.switch).toHaveBeenCalledWith(10, 'ENST000002')
    expect(result.transcripts.value).toEqual(updatedTranscripts)
  })

  it('inserts and switches transcript', async () => {
    const newTranscript: TranscriptInsertRow = {
      transcript_id: 'ENST000099',
      gene_symbol: 'BRCA1',
      source: 'manual',
      is_canonical: 0
    }
    const updatedTranscripts: TranscriptAnnotation[] = [
      {
        id: 3,
        variant_id: 10,
        transcript_id: 'ENST000099',
        gene_symbol: 'BRCA1',
        is_selected: 1,
        is_canonical: 0
      }
    ]

    window.api.transcripts.list = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(updatedTranscripts)
    window.api.transcripts.insertAndSwitch = vi.fn().mockResolvedValue(undefined)

    const variantId = ref<number | null>(10)
    const [result, appInstance] = withSetup(() => useTranscripts(variantId))
    app = appInstance

    await flushPromises()

    const ok = await result.insertAndSwitch(newTranscript)
    expect(ok).toBe(true)
    expect(window.api.transcripts.insertAndSwitch).toHaveBeenCalledWith(10, newTranscript)
    expect(result.transcripts.value).toEqual(updatedTranscripts)
  })
})
