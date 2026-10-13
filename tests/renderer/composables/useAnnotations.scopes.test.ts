/**
 * The cohort table (global scope) and the case table (per-case scope) share
 * one annotation cache keyed by coordinates. An entry that was filled for one
 * scope only must not pass as "already loaded" for the other.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMockApi } from '../../utils/mock-api'
import { useAnnotations, _resetAnnotationsForTesting } from '@renderer/composables/useAnnotations'
import { logService } from '@renderer/services/LogService'

const V = ['chr1', 100, 'A', 'G'] as const
const KEY = 'chr1:100:A:G'
const ROW = { id: 11, chr: 'chr1', pos: 100, ref: 'A', alt: 'G' }
const CASE_ID = 1
const GLOBAL_ROW = { starred: 1, global_comment: 'g' }
const CASE_ROW = { case_id: CASE_ID, variant_id: 11, starred: 1 }

describe('annotation cache shared by the cohort and the case table', () => {
  let a: ReturnType<typeof useAnnotations>

  beforeEach(() => {
    _resetAnnotationsForTesting()
    window.api = createMockApi()
    window.api.annotations.batchGet = vi.fn((caseId: number | null) =>
      Promise.resolve({
        [KEY]: { global: GLOBAL_ROW, perCase: caseId === null ? null : CASE_ROW }
      })
    ) as never
    window.api.annotations.getGlobal = vi.fn().mockResolvedValue(GLOBAL_ROW)
    window.api.annotations.getForVariant = vi
      .fn()
      .mockResolvedValue({ global: GLOBAL_ROW, perCase: CASE_ROW })
    a = useAnnotations({ genomeBuild: 'GRCh38' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('a row the cohort table loaded still gets its per-case annotation (batch)', async () => {
    await a.loadGlobalAnnotationsBatch([ROW])
    expect(a.isStarred(...V)).toBe(false)

    await a.loadAnnotationsBatch(CASE_ID, [ROW])

    expect(window.api.annotations.batchGet).toHaveBeenLastCalledWith(
      CASE_ID,
      [{ chr: 'chr1', pos: 100, ref: 'A', alt: 'G', variantId: 11 }],
      null
    )
    expect(a.isStarred(...V)).toBe(true)
  })

  it('a row the cohort table loaded still gets its per-case annotation (single)', async () => {
    await a.loadGlobalAnnotations(...V)

    await a.loadAnnotations(CASE_ID, ...V)

    expect(window.api.annotations.getForVariant).toHaveBeenCalledTimes(1)
    expect(a.isStarred(...V)).toBe(true)
  })

  it('a row the case table loaded needs no global reload', async () => {
    await a.loadAnnotationsBatch(CASE_ID, [ROW])
    vi.mocked(window.api.annotations.batchGet).mockClear()

    await a.loadGlobalAnnotationsBatch([ROW])
    await a.loadGlobalAnnotations(...V)

    expect(window.api.annotations.batchGet).not.toHaveBeenCalled()
    expect(window.api.annotations.getGlobal).not.toHaveBeenCalled()
  })

  it('a cohort reload of a loaded row is still skipped', async () => {
    await a.loadGlobalAnnotationsBatch([ROW])
    await a.loadGlobalAnnotationsBatch([ROW])

    expect(window.api.annotations.batchGet).toHaveBeenCalledTimes(1)
  })

  it('a global write on a row that was never loaded does not hide its per-case annotation', async () => {
    window.api.annotations.upsertGlobal = vi.fn().mockResolvedValue(GLOBAL_ROW)
    await a.toggleGlobalStar(...V)

    await a.loadAnnotationsBatch(CASE_ID, [ROW])

    expect(a.isStarred(...V)).toBe(true)
  })

  it('a per-case write on a row that was never loaded does not hide its global annotation', async () => {
    window.api.annotations.upsertPerCase = vi.fn().mockResolvedValue(CASE_ROW)
    await a.toggleStar(CASE_ID, 11, ...V)
    expect(a.isGlobalStarred(...V)).toBe(false)

    // The cohort table shows the row next: only the global slot is fetched,
    // and the per-case annotation written above survives.
    await a.loadGlobalAnnotationsBatch([ROW])

    expect(a.isGlobalStarred(...V)).toBe(true)
    expect(a.getAnnotations(...V)?.perCase).toEqual(CASE_ROW)
  })

  it('a case batch is not answered by a cohort batch still in flight', async () => {
    let resolveGlobal!: (value: unknown) => void
    vi.mocked(window.api.annotations.batchGet).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveGlobal = resolve
      }) as never
    )
    const cohortLoad = a.loadGlobalAnnotationsBatch([ROW])

    await a.loadAnnotationsBatch(CASE_ID, [ROW])
    expect(window.api.annotations.batchGet).toHaveBeenCalledTimes(2)
    expect(a.isStarred(...V)).toBe(true)

    // The slower cohort response must not wipe the per-case slot.
    resolveGlobal({ [KEY]: { global: GLOBAL_ROW, perCase: null } })
    await cohortLoad
    expect(a.isStarred(...V)).toBe(true)
    expect(a.isGlobalStarred(...V)).toBe(true)
  })
})

// Global annotations are keyed by genome build (#577).
describe('global annotations of one genome build', () => {
  beforeEach(() => {
    _resetAnnotationsForTesting()
    window.api = createMockApi()
    window.api.annotations.batchGet = vi.fn().mockResolvedValue({
      [KEY]: { global: GLOBAL_ROW, perCase: null }
    }) as never
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('a global write without a known build is not sent and reports the failure', async () => {
    const logged = vi.spyOn(logService, 'error').mockImplementation(() => undefined)
    const a = useAnnotations({ genomeBuild: null })
    window.api.annotations.upsertGlobal = vi.fn()
    expect(await a.toggleGlobalStar(...V)).toBe(false)
    expect(await a.setGlobalAcmgClassification(...V, 'Pathogenic')).toBe(false)
    expect(window.api.annotations.upsertGlobal).not.toHaveBeenCalled()
    expect(logged).toHaveBeenCalledTimes(2)
  })

  it('a global load without a known build sends nothing', async () => {
    await useAnnotations({ genomeBuild: null }).loadGlobalAnnotationsBatch([ROW])
    expect(window.api.annotations.batchGet).not.toHaveBeenCalled()
  })

  it('a view of another build never reads the entries of the first', async () => {
    const b38 = useAnnotations({ genomeBuild: 'GRCh38' })
    const b37 = useAnnotations({ genomeBuild: 'GRCh37' })
    await b38.loadGlobalAnnotationsBatch([ROW])
    expect(b38.isGlobalStarred(...V)).toBe(true)
    expect(b37.isGlobalStarred(...V)).toBe(false)

    // The GRCh37 view's own request empties the cache and asks for its build.
    vi.mocked(window.api.annotations.batchGet).mockResolvedValueOnce({
      [KEY]: { global: null, perCase: null }
    } as never)
    await b37.loadGlobalAnnotationsBatch([ROW])
    expect(window.api.annotations.batchGet).toHaveBeenLastCalledWith(
      null,
      [{ chr: 'chr1', pos: 100, ref: 'A', alt: 'G' }],
      'GRCh37'
    )
    expect(b37.isGlobalStarred(...V)).toBe(false)
    expect(b38.isGlobalStarred(...V)).toBe(false)
  })
})
