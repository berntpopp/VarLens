import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createApp, effectScope, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { AppStateKey } from '@renderer/composables/useAppState'
import { useDatabaseStore } from '@renderer/stores/databaseStore'
import { useBulkTriageSelection } from '@renderer/composables/useBulkTriageSelection'
import { createScopedAnnotationOps } from '@renderer/composables/annotation-scoped-ops'
import {
  annotationCache,
  beginAnnotationRequest,
  cacheSet,
  ensurePerCaseSlotOwner,
  getPerCaseByVariantId,
  inFlightMutations,
  perCaseSlotKey,
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
        batchGet: vi.fn()
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
})
