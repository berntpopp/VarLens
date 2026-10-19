/* eslint-disable vue/one-component-per-file -- test hosts */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createApp, effectScope, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { AppStateKey } from '@renderer/composables/useAppState'
import { useDatabaseStore } from '@renderer/stores/databaseStore'
import { useBulkTriageSelection } from '@renderer/composables/useBulkTriageSelection'
import { createScopedAnnotationOps } from '@renderer/composables/annotation-scoped-ops'
import {
  allocateMutationId,
  annotationCache,
  beginAnnotationRequest,
  bumpWriteVersion,
  cacheSet,
  clearMutationTracker,
  ensurePerCaseSlotOwner,
  getCachedVariantId,
  getConfirmedWriteVersion,
  getPerCaseByVariantId,
  getWriteVersion,
  inFlightMutations,
  invalidateAnnotationGeneration,
  isLoadingCaseVariant,
  markAwaited,
  perCaseSlotKey,
  perCaseVersionSlot,
  removeInFlightMutation,
  resetAnnotationState,
  setCachedVariantId,
  setPerCaseByVariantId,
  variantKey
} from '@renderer/composables/annotation-cache'
import type { WindowAPI } from '@shared/types/api'
import type { CaseVariantAnnotation } from '@shared/types/database-entities'

function defer<T = unknown>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const coords = { chr: '1', pos: 100, ref: 'A', alt: 'T' }
const key = variantKey(coords)
const scope = { kind: 'case' as const, caseId: 1, variantId: 11, build: 'GRCh38' }

function mockPerCase(
  id: number,
  extra: Partial<CaseVariantAnnotation> = {}
): CaseVariantAnnotation {
  return {
    id,
    case_id: 1,
    variant_id: id,
    starred: 0,
    acmg_classification: 'Benign',
    acmg_evidence: null,
    per_case_comment: 'old',
    created_at: 0,
    updated_at: 0,
    ...extra
  }
}

describe('Round 20 regression defects', () => {
  let api: WindowAPI

  beforeEach(() => {
    setActivePinia(createPinia())
    const db = useDatabaseStore()
    db.currentPath = '/data/a.db'
    resetAnnotationState()
    api = {
      annotations: {
        upsertPerCase: vi.fn(),
        upsertGlobal: vi.fn(),
        batchUpsertPerCase: vi.fn(),
        batchGet: vi.fn(),
        getForVariant: vi.fn()
      }
    } as unknown as WindowAPI
    ;(window as unknown as { api: WindowAPI }).api = api
  })

  it('Defect 1: delayed response from switched database does not contaminate new database perCaseByVariantId', async () => {
    beginAnnotationRequest(1, 'GRCh38')
    cacheSet(key, { global: null, perCase: mockPerCase(11) })
    ensurePerCaseSlotOwner(key, 1, 11)
    setPerCaseByVariantId(1, 11, mockPerCase(11), key)

    const d = defer<CaseVariantAnnotation>()
    vi.mocked(api.annotations.upsertPerCase).mockReturnValue(d.promise as never)

    const ops = createScopedAnnotationOps(api, () => undefined)
    const pendingMutation = ops.setAcmgClassification(scope, coords, 'Pathogenic')

    // Switch to database B
    const db = useDatabaseStore()
    db.currentPath = '/data/b.db'
    beginAnnotationRequest(1, 'GRCh38')
    cacheSet(key, { global: null, perCase: null })
    setCachedVariantId(key, 11)
    setPerCaseByVariantId(1, 11, null, key)

    // Resolve database A write
    d.resolve(mockPerCase(11, { acmg_classification: 'Pathogenic' }))
    await pendingMutation

    expect(annotationCache.value.get(key)?.perCase).toBeNull()
    expect(getPerCaseByVariantId(1, 11, key)).toBeNull()
  })

  it('Defect 3: loadBatch refresh preserves row-specific in-flight mutation; subsequent toggle inverts correctly', async () => {
    beginAnnotationRequest(1, 'GRCh38')
    cacheSet(key, { global: null, perCase: mockPerCase(11) })
    ensurePerCaseSlotOwner(key, 1, 11)
    setPerCaseByVariantId(1, 11, mockPerCase(11), key)

    const calls: unknown[] = []
    const pending: Array<ReturnType<typeof defer>> = []
    vi.mocked(api.annotations.upsertPerCase).mockImplementation((_cid, _vid, u) => {
      calls.push(u)
      const q = defer()
      pending.push(q)
      return q.promise as never
    })
    vi.mocked(api.annotations.batchGet).mockResolvedValue({
      [key]: { global: null, perCase: mockPerCase(11) }
    } as never)

    const ops = createScopedAnnotationOps(api, () => undefined)
    const p1 = ops.toggleStar(scope, coords)
    await ops.loadBatch(scope, [{ id: 11, ...coords, is_starred: false }])
    const p2 = ops.toggleStar(scope, coords)

    expect(calls).toEqual([{ starred: true }, { starred: false }])
    pending.forEach((q) => q.resolve(mockPerCase(11, { starred: 1 })))
    await Promise.all([p1, p2])
  })

  it('Defect 4: bulk confirmation confirms and prunes all selected sibling mutations sharing coordinate', async () => {
    beginAnnotationRequest(1, 'GRCh38')
    cacheSet(key, { global: null, perCase: mockPerCase(11) })
    ensurePerCaseSlotOwner(key, 1, 11)
    setPerCaseByVariantId(1, 11, mockPerCase(11), key)

    const d = defer<CaseVariantAnnotation>()
    vi.mocked(api.annotations.upsertPerCase).mockReturnValue(d.promise as never)
    vi.mocked(api.annotations.batchUpsertPerCase).mockResolvedValue({ updatedCount: 2 } as never)
    vi.mocked(api.annotations.batchGet).mockImplementation(
      (_cid, keys) =>
        Promise.resolve(
          Object.fromEntries(
            (keys as Array<{ variantId: number }>).map((k) => [
              key,
              {
                global: null,
                perCase: mockPerCase(k.variantId, { acmg_classification: 'Pathogenic' })
              }
            ])
          )
        ) as never
    )

    const ops = createScopedAnnotationOps(api, () => undefined)
    const p = ops.setAcmgClassification(scope, coords, 'Likely pathogenic')

    // Sibling 12 owns the slot in cache
    cacheSet(key, { global: null, perCase: mockPerCase(12) })
    ensurePerCaseSlotOwner(key, 1, 12)
    setPerCaseByVariantId(1, 12, mockPerCase(12), key)

    const eff = effectScope()
    const app = createApp({})
    app.provide(AppStateKey, {
      selectedPanelVariant: ref({ id: 11, case_id: 1, ...coords }),
      selectedCaseId: ref(1)
    })

    const bulk = app.runWithContext(() =>
      eff.run(() =>
        useBulkTriageSelection({
          items: () => [
            { id: 11, ...coords },
            { id: 12, ...coords }
          ],
          getItemId: (r: { id: number }) => r.id,
          caseId: 1,
          genomeBuild: 'GRCh38'
        })
      )
    )!

    bulk.toggleSelectAll(true)
    await bulk.applyBulkTriage({ acmg_classification: 'Pathogenic' })

    expect(annotationCache.value.get(key)?.perCase?.acmg_classification).toBe('Pathogenic')
    expect(inFlightMutations.get(perCaseSlotKey(1, 11, key))).toBeUndefined()

    d.resolve(mockPerCase(11, { acmg_classification: 'Likely pathogenic' }))
    await p
    eff.stop()
  })

  it('Round 21 Defect 1: allocateMutationId provides unique IDs preventing cross-path removal', () => {
    const id1 = allocateMutationId()
    const id2 = allocateMutationId()
    expect(id2).toBeGreaterThan(id1)

    const slotKey = perCaseSlotKey(1, 11, key)
    inFlightMutations.set(slotKey, [
      { id: id1, fieldGroup: 'acmg', writeVer: 1, patch: { acmg_classification: 'Pathogenic' } },
      { id: id2, fieldGroup: 'star', writeVer: 2, patch: { starred: 1 } }
    ])

    removeInFlightMutation(slotKey, id2)
    const remaining = inFlightMutations.get(slotKey)
    expect(remaining?.length).toBe(1)
    expect(remaining?.[0].id).toBe(id1)
  })

  it('Round 21 Defect 2: uncached write registers in inFlightMutations and preserves newer bulk classification', async () => {
    beginAnnotationRequest(1, 'GRCh38')
    ensurePerCaseSlotOwner(key, 1, 11)
    expect(annotationCache.value.has(key)).toBe(false)

    const d = defer<CaseVariantAnnotation>()
    vi.mocked(api.annotations.upsertPerCase).mockReturnValue(d.promise as never)
    vi.mocked(api.annotations.batchUpsertPerCase).mockResolvedValue({ updatedCount: 1 } as never)
    vi.mocked(api.annotations.batchGet).mockResolvedValue({
      [key]: { global: null, perCase: mockPerCase(11, { acmg_classification: 'Pathogenic' }) }
    } as never)

    const ops = createScopedAnnotationOps(api, () => undefined)
    const pComment = ops.upsertComment(scope, coords, 'test note')

    const slotKey = perCaseSlotKey(1, 11, key)
    expect(inFlightMutations.has(slotKey)).toBe(true)

    const eff = effectScope()
    const app = createApp({})
    app.provide(AppStateKey, {
      selectedPanelVariant: ref(null),
      selectedCaseId: ref(1)
    })
    const bulk = app.runWithContext(() =>
      eff.run(() =>
        useBulkTriageSelection({
          items: () => [{ id: 11, ...coords }],
          getItemId: (r: { id: number }) => r.id,
          caseId: 1,
          genomeBuild: 'GRCh38'
        })
      )
    )!
    bulk.toggleSelectAll(true)
    await bulk.applyBulkTriage({ acmg_classification: 'Pathogenic' })

    d.resolve(mockPerCase(11, { per_case_comment: 'test note', acmg_classification: 'Benign' }))
    await pComment

    expect(annotationCache.value.get(key)?.perCase?.acmg_classification).toBe('Pathogenic')
    expect(annotationCache.value.get(key)?.perCase?.per_case_comment).toBe('test note')
    eff.stop()
  })

  it('Round 21 Defect 3: sibling row version bumps do not interfere with pending toggles', () => {
    beginAnnotationRequest(1, 'GRCh38')
    const vSlot11 = perCaseVersionSlot(1, 11, 'star')
    const vSlot12 = perCaseVersionSlot(1, 12, 'star')

    const verA = bumpWriteVersion(key, vSlot11)
    expect(verA).toBe(1)

    const verB = bumpWriteVersion(key, vSlot12)
    expect(verB).toBe(1)

    expect(getWriteVersion(key, vSlot11)).toBe(1)
    expect(getWriteVersion(key, vSlot12)).toBe(1)

    const bulkVer = bumpWriteVersion(key, 'perCase:star')
    expect(bulkVer).toBe(2)
    expect(getWriteVersion(key, vSlot11)).toBe(2)
    expect(getWriteVersion(key, vSlot12)).toBe(2)

    const verA2 = bumpWriteVersion(key, vSlot11)
    expect(verA2).toBe(3)
    expect(getWriteVersion(key, vSlot11)).toBe(3)
    expect(getWriteVersion(key, vSlot12)).toBe(2)
  })

  it('Round 22 Defect 1: clearMutationTracker preserves monotonic nextMutationId and stale epoch writes do not remove current epoch in-flight mutations', async () => {
    const id1 = allocateMutationId()
    clearMutationTracker()
    const id2 = allocateMutationId()
    expect(id2).toBeGreaterThan(id1)

    beginAnnotationRequest(1, 'GRCh38')
    ensurePerCaseSlotOwner(key, 1, 11)
    const slotKey = perCaseSlotKey(1, 11, key)

    const d1 = defer<CaseVariantAnnotation>()
    vi.mocked(api.annotations.upsertPerCase).mockReturnValue(d1.promise as never)

    const ops = createScopedAnnotationOps(api, () => undefined)
    const pSave1 = ops.upsertComment(scope, coords, 'epoch 1 note')

    resetAnnotationState()
    beginAnnotationRequest(2, 'GRCh38')

    const idNew = allocateMutationId()
    inFlightMutations.set(slotKey, [
      { id: idNew, fieldGroup: 'comment', writeVer: 1, patch: { per_case_comment: 'epoch 2 note' } }
    ])

    d1.resolve(mockPerCase(11, { per_case_comment: 'epoch 1 note' }))
    await pSave1

    expect(inFlightMutations.get(slotKey)?.some((m) => m.id === idNew)).toBe(true)
  })

  it('Round 22 Defect 2: bulk triage records owner-specific write versions so siblings with lower versions are not rejected as stale', async () => {
    beginAnnotationRequest(1, 'GRCh38')
    const vSlot11 = perCaseVersionSlot(1, 11, 'acmg')
    const vSlot12 = perCaseVersionSlot(1, 12, 'acmg')

    for (let i = 0; i < 5; i++) {
      bumpWriteVersion(key, vSlot11)
    }
    expect(getWriteVersion(key, vSlot11)).toBe(5)
    expect(getWriteVersion(key, vSlot12)).toBe(0)

    const eff = effectScope()
    const app = createApp({})
    app.provide(AppStateKey, {
      selectedPanelVariant: ref(null),
      selectedCaseId: ref(1)
    })
    vi.mocked(api.annotations.batchUpsertPerCase).mockResolvedValue({ updatedCount: 2 } as never)
    vi.mocked(api.annotations.batchGet).mockResolvedValue({
      [key]: {
        global: null,
        perCase: mockPerCase(11, { acmg_classification: 'Pathogenic' })
      }
    } as never)

    const bulk = app.runWithContext(() =>
      eff.run(() =>
        useBulkTriageSelection({
          items: () => [
            { id: 11, ...coords },
            { id: 12, ...coords }
          ],
          getItemId: (r: { id: number }) => r.id,
          caseId: 1,
          genomeBuild: 'GRCh38'
        })
      )
    )!
    bulk.toggleSelectAll(true)
    await bulk.applyBulkTriage({ acmg_classification: 'Pathogenic' })

    expect(getConfirmedWriteVersion(key, vSlot11)).toBe(6)
    expect(getConfirmedWriteVersion(key, vSlot12)).toBe(1)

    const nextVer12 = bumpWriteVersion(key, vSlot12)
    expect(nextVer12).toBe(2)
    expect(nextVer12).toBeGreaterThan(getConfirmedWriteVersion(key, vSlot12))

    eff.stop()
  })

  it('Round 26 Fix 1: load does not overwrite optimistic perCaseByVariantId on resolve', async () => {
    beginAnnotationRequest(1, 'GRCh38')
    ensurePerCaseSlotOwner(key, 1, 11)
    const baseEntry = mockPerCase(11, { starred: 0 })
    cacheSet(key, { global: null, perCase: baseEntry })
    setPerCaseByVariantId(1, 11, baseEntry, key)

    const d = defer<CaseVariantAnnotation>()
    vi.mocked(api.annotations.upsertPerCase).mockReturnValue(d.promise as never)
    const ops = createScopedAnnotationOps(api, () => undefined)
    void ops.toggleStar(scope, coords)

    expect(getPerCaseByVariantId(1, 11)?.starred).toBe(1)

    vi.mocked(api.annotations.getForVariant).mockResolvedValue({
      global: null,
      perCase: baseEntry
    } as never)
    await ops.load(scope, coords)

    expect(getPerCaseByVariantId(1, 11)?.starred).toBe(1)
    d.resolve({ ...baseEntry, starred: 1 })
  })

  it('Round 26 Fix 2: loadBatch does not suppress sibling 12 when sibling 11 is loading at same coordinates', async () => {
    beginAnnotationRequest(1, 'GRCh38')
    const d11 = defer<Record<string, unknown>>()
    vi.mocked(api.annotations.batchGet).mockReturnValueOnce(d11.promise as never)

    const ops = createScopedAnnotationOps(api, () => undefined)
    const p1 = ops.loadBatch(scope, [{ id: 11, ...coords }])
    expect(isLoadingCaseVariant(1, 11)).toBe(true)

    const d12 = defer<Record<string, unknown>>()
    vi.mocked(api.annotations.batchGet).mockReturnValueOnce(d12.promise as never)
    const p2 = ops.loadBatch(scope, [{ id: 12, ...coords }])

    expect(vi.mocked(api.annotations.batchGet)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(api.annotations.batchGet).mock.calls[1][1]).toEqual([
      { chr: '1', pos: 100, ref: 'A', alt: 'T', variantId: 12 }
    ])

    d11.resolve({ [key]: { global: null, perCase: mockPerCase(11) } })
    d12.resolve({ [key]: { global: null, perCase: mockPerCase(12) } })
    await Promise.all([p1, p2])

    expect(isLoadingCaseVariant(1, 11)).toBe(false)
    expect(isLoadingCaseVariant(1, 12)).toBe(false)
  })

  it('Round 26 Fix 3: multi-wave loadBatch preserves awaited status across waves after page invalidation', async () => {
    beginAnnotationRequest(1, 'GRCh38')
    const dWave0 = defer<Record<string, unknown>>()
    const dWave1 = defer<Record<string, unknown>>()
    vi.mocked(api.annotations.batchGet)
      .mockReturnValueOnce(dWave0.promise as never)
      .mockReturnValueOnce(dWave1.promise as never)

    markAwaited('case', key)

    const ops = createScopedAnnotationOps(api, () => undefined)
    const p = ops.loadBatch(scope, [
      { id: 11, ...coords },
      { id: 12, ...coords }
    ])

    invalidateAnnotationGeneration('case')

    dWave0.resolve({ [key]: { global: null, perCase: mockPerCase(11) } })
    await Promise.resolve()

    dWave1.resolve({ [key]: { global: null, perCase: mockPerCase(12) } })
    await p

    expect(getPerCaseByVariantId(1, 11)?.id).toBe(11)
    expect(getPerCaseByVariantId(1, 12)?.id).toBe(12)
  })

  it('Round 26 Fix 4: rejected write when current === undefined does not overwrite unannotated sibling in cache', async () => {
    beginAnnotationRequest(1, 'GRCh38')
    cacheSet(key, { global: null, perCase: null })
    setCachedVariantId(key, 12)
    ensurePerCaseSlotOwner(key, 1, 12)

    const scope11 = { kind: 'case' as const, caseId: 1, variantId: 11, build: 'GRCh38' }
    vi.mocked(api.annotations.upsertPerCase).mockRejectedValue(new Error('Write failed'))

    const ops = createScopedAnnotationOps(api, () => undefined)
    const res = await ops.toggleStar(scope11, coords)
    expect(res).toBe(false)

    expect(getCachedVariantId(key)).toBe(12)
    expect(annotationCache.value.get(key)?.perCase).toBeNull()
  })

  it('Round 26 Fix 5: loadBatch detects siblingSwitch when both siblings were loaded and one is requested alone', async () => {
    beginAnnotationRequest(1, 'GRCh38')
    const entry11 = mockPerCase(11, { starred: 1 })
    const entry12 = mockPerCase(12, { starred: 0 })
    vi.mocked(api.annotations.batchGet)
      .mockResolvedValueOnce({ [key]: { global: null, perCase: entry11 } } as never)
      .mockResolvedValueOnce({ [key]: { global: null, perCase: entry12 } } as never)
      .mockResolvedValueOnce({ [key]: { global: null, perCase: entry11 } } as never)

    const ops = createScopedAnnotationOps(api, () => undefined)
    await ops.loadBatch(scope, [
      { id: 11, ...coords },
      { id: 12, ...coords }
    ])

    expect(getPerCaseByVariantId(1, 11)?.starred).toBe(1)
    expect(getPerCaseByVariantId(1, 12)?.starred).toBe(0)
    expect(annotationCache.value.get(key)?.perCase?.variant_id).toBe(12)

    await ops.loadBatch(scope, [{ id: 11, ...coords }])

    expect(annotationCache.value.get(key)?.perCase?.variant_id).toBe(11)
    expect(getPerCaseByVariantId(1, 11)?.starred).toBe(1)
    expect(getPerCaseByVariantId(1, 12)?.starred).toBe(0)
  })

  it('Round 28 Fix 1: non-owner sibling write triggers annotationCache reactivity on optimistic and confirmed writes', async () => {
    beginAnnotationRequest(1, 'GRCh38')
    const entry11 = mockPerCase(11, { starred: 1 })
    const entry12 = mockPerCase(12, { starred: 0 })
    cacheSet(key, { global: null, perCase: entry11 })
    setCachedVariantId(key, 11)
    ensurePerCaseSlotOwner(key, 1, 11)
    setPerCaseByVariantId(1, 11, entry11, key)
    setPerCaseByVariantId(1, 12, entry12, key)

    const dWrite = defer<CaseVariantAnnotation>()
    vi.mocked(api.annotations.upsertPerCase).mockReturnValueOnce(dWrite.promise as never)

    const ops = createScopedAnnotationOps(api, () => undefined)
    const scope12 = { kind: 'case' as const, caseId: 1, variantId: 12, build: 'GRCh38' }
    const p = ops.toggleStar(scope12, coords)

    expect(getPerCaseByVariantId(1, 12, key)?.starred).toBe(1)

    dWrite.resolve(mockPerCase(12, { starred: 1, acmg_classification: 'Pathogenic' }))
    await p

    expect(getPerCaseByVariantId(1, 12, key)?.acmg_classification).toBe('Pathogenic')
    expect(getPerCaseByVariantId(1, 11, key)?.starred).toBe(1)
  })

  it('Round 28 Fix 2: loadBatch wave 2 preserves perCaseByVariantId when sibling write bumps keyVersion', async () => {
    beginAnnotationRequest(1, 'GRCh38')
    const entry11 = mockPerCase(11, { starred: 0 })
    const entry12 = mockPerCase(12, { starred: 1, acmg_classification: 'Likely pathogenic' })
    const dWave1 = defer<Record<string, unknown>>()
    vi.mocked(api.annotations.batchGet)
      .mockResolvedValueOnce({ [key]: { global: null, perCase: entry11 } } as never)
      .mockReturnValueOnce(dWave1.promise as never)
    vi.mocked(api.annotations.upsertPerCase).mockResolvedValueOnce(
      mockPerCase(11, { starred: 1 }) as never
    )

    const ops = createScopedAnnotationOps(api, () => undefined)
    const batchPromise = ops.loadBatch(scope, [
      { id: 11, ...coords },
      { id: 12, ...coords }
    ])

    await Promise.resolve()
    await Promise.resolve()

    await ops.toggleStar({ kind: 'case', caseId: 1, variantId: 11, build: 'GRCh38' }, coords)

    dWave1.resolve({ [key]: { global: null, perCase: entry12 } })
    await batchPromise

    expect(getPerCaseByVariantId(1, 11, key)?.starred).toBe(1)
    expect(getPerCaseByVariantId(1, 12, key)?.starred).toBe(1)
    expect(getPerCaseByVariantId(1, 12, key)?.acmg_classification).toBe('Likely pathogenic')
  })

  it('Round 28 Fix 3: load with variantId promotes already-loaded sibling from perCaseByVariantId without extra IPC', async () => {
    beginAnnotationRequest(1, 'GRCh38')
    const entry11 = mockPerCase(11, { starred: 1 })
    const entry12 = mockPerCase(12, { starred: 0, acmg_classification: 'Benign' })
    cacheSet(key, { global: null, perCase: entry12 })
    setCachedVariantId(key, 12)
    ensurePerCaseSlotOwner(key, 1, 12)
    setPerCaseByVariantId(1, 11, entry11, key)
    setPerCaseByVariantId(1, 12, entry12, key)

    const ops = createScopedAnnotationOps(api, () => undefined)
    await ops.load({ kind: 'case', caseId: 1, variantId: 11, build: 'GRCh38' }, coords)

    expect(api.annotations.getForVariant).not.toHaveBeenCalled()
    expect(annotationCache.value.get(key)?.perCase?.variant_id).toBe(11)
    expect(annotationCache.value.get(key)?.perCase?.starred).toBe(1)
    expect(getPerCaseByVariantId(1, 12, key)?.acmg_classification).toBe('Benign')
  })

  it('Round 28 Fix 4: uncached concurrent mutations preserve confirmed field patch on null base when second field group fails', async () => {
    beginAnnotationRequest(1, 'GRCh38')
    const dAcmg = defer<CaseVariantAnnotation>()
    vi.mocked(api.annotations.upsertPerCase).mockReturnValueOnce(dAcmg.promise as never)

    const ops = createScopedAnnotationOps(api, () => undefined)
    const scope11 = { kind: 'case' as const, caseId: 1, variantId: 11, build: 'GRCh38' }
    const pAcmg = ops.setAcmgClassification(scope11, coords, 'Pathogenic')

    // Simulate bulk star confirmation setting a confirmedFieldPatch while confirmedBases is still null
    const slotKey = perCaseSlotKey(1, 11, key)
    const { setConfirmedFieldPatch } = await import('@renderer/composables/annotation-cache')
    setConfirmedFieldPatch(slotKey, 'star', { starred: 1 })

    dAcmg.reject(new Error('ACMG write failed'))
    const resAcmg = await pAcmg
    expect(resAcmg).toBe(false)

    expect(getPerCaseByVariantId(1, 11, key)?.starred).toBe(1)
    expect(getPerCaseByVariantId(1, 11, key)?.acmg_classification ?? null).toBeNull()
  })

  it('cold load with variantId uses batchGet with variantId and does not cache a sibling annotation under the requested ID', async () => {
    beginAnnotationRequest(1, 'GRCh38')
    vi.mocked(api.annotations.batchGet).mockResolvedValueOnce({
      [key]: {
        global: null,
        perCase: mockPerCase(11, { acmg_classification: 'Pathogenic' }),
        perCaseByVariantId: { 12: null }
      }
    } as never)

    const ops = createScopedAnnotationOps(api, () => undefined)
    await ops.load({ kind: 'case', caseId: 1, variantId: 12, build: 'GRCh38' }, coords)

    expect(api.annotations.batchGet).toHaveBeenCalledWith(
      1,
      [{ chr: '1', pos: 100, ref: 'A', alt: 'T', variantId: 12 }],
      null
    )
    expect(getPerCaseByVariantId(1, 12, key)).toBeNull()
    expect(getPerCaseByVariantId(1, 11, key)).toBeUndefined()
  })

  it('overlapping sibling loads 11 -> 12 -> 11 do not let delayed first load for 11 overwrite newer 11 in either cache', async () => {
    beginAnnotationRequest(1, 'GRCh38')
    const d11Old = defer<Record<string, unknown>>()
    const d12 = defer<Record<string, unknown>>()
    const d11New = defer<Record<string, unknown>>()
    vi.mocked(api.annotations.batchGet)
      .mockReturnValueOnce(d11Old.promise as never)
      .mockReturnValueOnce(d12.promise as never)
      .mockReturnValueOnce(d11New.promise as never)

    const ops = createScopedAnnotationOps(api, () => undefined)
    const p11Old = ops.load({ kind: 'case', caseId: 1, variantId: 11, build: 'GRCh38' }, coords)
    const p12 = ops.load({ kind: 'case', caseId: 1, variantId: 12, build: 'GRCh38' }, coords)
    d12.resolve({
      [key]: { global: null, perCase: mockPerCase(12, { acmg_classification: 'Uncertain significance' }) }
    })
    await p12

    const p11New = ops.load({ kind: 'case', caseId: 1, variantId: 11, build: 'GRCh38' }, coords)
    d11New.resolve({
      [key]: { global: null, perCase: mockPerCase(11, { acmg_classification: 'Benign' }) }
    })
    await p11New

    // Delayed first response for 11 resolves with stale Pathogenic
    d11Old.resolve({
      [key]: { global: null, perCase: mockPerCase(11, { acmg_classification: 'Pathogenic' }) }
    })
    await p11Old

    expect(annotationCache.value.get(key)?.perCase?.acmg_classification).toBe('Benign')
    expect(getPerCaseByVariantId(1, 11, key)?.acmg_classification).toBe('Benign')
    expect(getPerCaseByVariantId(1, 12, key)?.acmg_classification).toBe('Uncertain significance')
  })

  it('older loadBatch resolving after a non-owner sibling write does not overwrite the newly saved sibling annotation', async () => {
    beginAnnotationRequest(1, 'GRCh38')
    setPerCaseByVariantId(1, 11, mockPerCase(11, { starred: 1 }), key)
    ensurePerCaseSlotOwner(key, 1, 11)
    cacheSet(key, {
      global: null,
      perCase: mockPerCase(11, { starred: 1 })
    })

    const dBatch = defer<Record<string, unknown>>()
    vi.mocked(api.annotations.batchGet).mockReturnValueOnce(dBatch.promise as never)
    vi.mocked(api.annotations.upsertPerCase).mockResolvedValueOnce(
      mockPerCase(12, { acmg_classification: 'Likely pathogenic' }) as never
    )

    const ops = createScopedAnnotationOps(api, () => undefined)
    const pBatch = ops.loadBatch(
      { kind: 'case', caseId: 1, build: 'GRCh38' },
      [{ ...coords, id: 12 }]
    )

    // Non-owner sibling 12 saves while loadBatch is in flight
    await ops.setAcmgClassification(
      { kind: 'case', caseId: 1, variantId: 12, build: 'GRCh38' },
      coords,
      'Likely pathogenic'
    )
    expect(getPerCaseByVariantId(1, 12, key)?.acmg_classification).toBe('Likely pathogenic')

    // Older loadBatch resolves with stale null for sibling 12
    dBatch.resolve({
      [key]: {
        global: null,
        perCase: mockPerCase(11, { starred: 1 }),
        perCaseByVariantId: { 12: null }
      }
    })
    await pBatch

    expect(getPerCaseByVariantId(1, 12, key)?.acmg_classification).toBe('Likely pathogenic')
  })

  it('two overlapping rejected saves on an initially unannotated variant roll back to null instead of retaining Save 1 optimistic state', async () => {
    beginAnnotationRequest(1, 'GRCh38')
    cacheSet(key, { global: null, perCase: null })
    const d1 = defer<CaseVariantAnnotation>()
    const d2 = defer<CaseVariantAnnotation>()
    vi.mocked(api.annotations.upsertPerCase)
      .mockReturnValueOnce(d1.promise as never)
      .mockReturnValueOnce(d2.promise as never)

    const ops = createScopedAnnotationOps(api, () => undefined)
    const scope11 = { kind: 'case' as const, caseId: 1, variantId: 11, build: 'GRCh38' }
    const p1 = ops.setAcmgClassification(scope11, coords, 'Pathogenic')
    const p2 = ops.setAcmgClassification(scope11, coords, 'Benign')

    d1.reject(new Error('save 1 failed'))
    d2.reject(new Error('save 2 failed'))
    await Promise.all([p1, p2])

    expect(annotationCache.value.get(key)?.perCase?.acmg_classification ?? null).toBeNull()
    expect(getPerCaseByVariantId(1, 11, key)?.acmg_classification ?? null).toBeNull()
  })

  it('rolls back coordinate slot when sibling mutation started after coordinate slot was still occupied by first variant', async () => {
    beginAnnotationRequest(1, 'GRCh38')
    cacheSet(key, { global: null, perCase: null })
    const d11 = defer<CaseVariantAnnotation>()
    const d12 = defer<CaseVariantAnnotation>()
    vi.mocked(api.annotations.upsertPerCase)
      .mockReturnValueOnce(d11.promise as never)
      .mockReturnValueOnce(d12.promise as never)

    const ops = createScopedAnnotationOps(api, () => undefined)
    const p11 = ops.setAcmgClassification(
      { kind: 'case', caseId: 1, variantId: 11, build: 'GRCh38' },
      coords,
      'Pathogenic'
    )
    const p12 = ops.setAcmgClassification(
      { kind: 'case', caseId: 1, variantId: 12, build: 'GRCh38' },
      coords,
      'Benign'
    )

    d11.reject(new Error('11 failed'))
    d12.reject(new Error('12 failed'))
    await Promise.all([p11, p12])

    expect(annotationCache.value.get(key)?.perCase?.acmg_classification ?? null).toBeNull()
    expect(getPerCaseByVariantId(1, 11, key)?.acmg_classification ?? null).toBeNull()
    expect(getPerCaseByVariantId(1, 12, key)?.acmg_classification ?? null).toBeNull()
  })
})
