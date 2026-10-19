import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createApp, effectScope, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
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
  confirmedBases,
  confirmedFieldPatches,
  ensurePerCaseSlotOwner,
  evictAnnotationCacheKeys,
  evictAnnotationCacheKeysForBulkTriage,
  getConfirmedWriteVersion,
  getPerCaseByVariantId,
  getWriteVersion,
  inFlightMutations,
  perCaseSlotKey,
  perCaseVersionSlot,
  resetAnnotationState,
  resetMutationTracker,
  setConfirmedFieldPatch,
  setConfirmedWriteVersion,
  setPerCaseByVariantId,
  variantKey
} from '@renderer/composables/annotation-cache'
import ShortlistPanel from '@renderer/components/shortlist/ShortlistPanel.vue'
import { AnnotationBuildKey } from '@renderer/composables/useAnnotations'
import { installCapabilities } from '../helpers/capabilities'
import type { WindowAPI } from '@shared/types/api'
import type { CaseVariantAnnotation } from '@shared/types/database-entities'
import type { ShortlistResult, ShortlistRow } from '@shared/types/shortlist'
import type { FilterPreset } from '@shared/types/filter-presets'

const shortlistState = {
  shortlistPresets: ref<Pick<FilterPreset, 'id' | 'name'>[]>([
    { id: 1, name: 'Tier 1 candidates' } as FilterPreset
  ]),
  selectedPresetId: ref<number | null>(1),
  result: ref<ShortlistResult | null>(null),
  loading: ref(false),
  error: ref<Error | null>(null),
  presetsLoading: ref(false),
  refresh: vi.fn()
}

vi.mock('@renderer/composables/useShortlistQuery', () => ({
  useShortlistQuery: () => shortlistState
}))

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

function minimalRow(overrides: Partial<ShortlistRow> = {}): ShortlistRow {
  return {
    id: 11,
    case_id: 1,
    variant_type: 'snv',
    chr: '1',
    pos: 100,
    ref: 'A',
    alt: 'T',
    gene_symbol: 'TEST1',
    hgvsc: 'c.100A>T',
    hgvsp: 'p.Lys34Asn',
    consequence: 'missense_variant',
    is_starred: false,
    rank: 1,
    rank_score: 0.9,
    rank_components: {
      impact: 1,
      pathogenicity: 0.8,
      rarity: 0.99,
      clinvar: 1,
      phenotype: 0
    },
    rank_clinvar_pinned: false,
    rank_starred_pinned: false,
    ...overrides
  } as ShortlistRow
}

const vuetify = createVuetify({ components, directives })

describe('Round 23 regression defects', () => {
  let api: WindowAPI
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    installCapabilities()
    const db = useDatabaseStore()
    db.currentPath = '/data/a.db'
    resetAnnotationState()
    api = {
      annotations: {
        upsertPerCase: vi.fn(),
        upsertGlobal: vi.fn(),
        batchUpsertPerCase: vi.fn(),
        batchGet: vi.fn(),
        getForVariant: vi.fn().mockResolvedValue({ global: null, perCase: null }),
        getGlobal: vi.fn().mockResolvedValue(null)
      },
      shell: {
        updateDomains: vi.fn()
      }
    } as unknown as WindowAPI
    ;(window as unknown as { api: WindowAPI }).api = api

    shortlistState.loading.value = false
    shortlistState.error.value = null
    shortlistState.result.value = null
    shortlistState.selectedPresetId.value = 1
  })

  function mountShortlist(caseId = 1) {
    return mount(ShortlistPanel, {
      props: { caseId },
      global: {
        plugins: [vuetify, pinia],
        provide: {
          [AnnotationBuildKey as symbol]: 'GRCh38'
        }
      }
    })
  }

  // Defect 1: Old bulk versions suppress newer saves after a case round trip
  describe('Defect 1: Old bulk versions suppress newer saves after case round trip', () => {
    it('1A: clearMutationTracker preserves monotonic write versions; resetMutationTracker resets them', () => {
      beginAnnotationRequest(1, 'GRCh38')
      const vSlot = perCaseVersionSlot(1, 11, 'acmg')
      expect(bumpWriteVersion(key, vSlot)).toBe(1)
      expect(bumpWriteVersion(key, vSlot)).toBe(2)
      expect(bumpWriteVersion(key, vSlot)).toBe(3)

      // Switching case triggers clearEntries() -> clearMutationTracker()
      clearMutationTracker()

      // Next write version MUST continue monotonically (not restart at 1)
      expect(bumpWriteVersion(key, vSlot)).toBe(4)
      expect(getWriteVersion(key, vSlot)).toBe(4)

      // In contrast, switching database / resetAnnotationState() calls resetMutationTracker()
      resetMutationTracker()
      expect(getWriteVersion(key, vSlot)).toBe(0)
      expect(bumpWriteVersion(key, vSlot)).toBe(1)
    })

    it('1B: evictAnnotationCacheKeysForBulkTriage from older epoch does not overwrite newer confirmed write versions or prune current epoch in-flight mutations', () => {
      beginAnnotationRequest(1, 'GRCh38')
      const slotKey = perCaseSlotKey(1, 11, key)
      const vSlot = perCaseVersionSlot(1, 11, 'acmg')

      // Simulate active in-flight mutation in current epoch
      const mutId = allocateMutationId()
      inFlightMutations.set(slotKey, [
        { id: mutId, fieldGroup: 'acmg', writeVer: 5, patch: { acmg_classification: 'Pathogenic' } }
      ])
      setConfirmedFieldPatch(slotKey, 'acmg', { acmg_classification: 'Pathogenic' })
      setConfirmedWriteVersion(key, vSlot, 5)

      // Eviction from older epoch (fromCurrentEpoch = false)
      evictAnnotationCacheKeysForBulkTriage(
        [key],
        ['acmg'],
        new Map(),
        { acmg_classification: 'Pathogenic' },
        undefined,
        false
      )

      // Active current-epoch mutation and write version must NOT be pruned or confirmed to older ver
      expect(inFlightMutations.get(slotKey)?.length).toBe(1)
      expect(inFlightMutations.get(slotKey)?.[0].id).toBe(mutId)
      expect(confirmedFieldPatches.get(slotKey)?.acmg).toBeDefined()
      expect(getConfirmedWriteVersion(key, vSlot)).toBe(5)
    })
  })

  // Defect 2: Sibling cache eviction destroys unresolved mutation history
  describe('Defect 2: Sibling cache eviction destroys unresolved mutation history', () => {
    it('2A: dropKeyState and deletePerCaseForCoordKey preserve in-flight mutation history and perCaseByVariantId for sibling rows with active mutations', () => {
      beginAnnotationRequest(1, 'GRCh38')
      const slotKey11 = perCaseSlotKey(1, 11, key)
      const mutId11 = allocateMutationId()
      inFlightMutations.set(slotKey11, [
        { id: mutId11, fieldGroup: 'star', writeVer: 1, patch: { starred: 1 } }
      ])
      confirmedBases.set(slotKey11, mockPerCase(11, { starred: 0 }))
      confirmedFieldPatches.set(slotKey11, { star: { starred: 1 } })
      setPerCaseByVariantId(1, 11, mockPerCase(11, { starred: 1 }), key)

      // Sibling row 12 without in-flight mutations
      setPerCaseByVariantId(1, 12, mockPerCase(12, { starred: 0 }), key)

      // Eviction occurs on the coordinate key (e.g. evictAnnotationCacheKeys)
      evictAnnotationCacheKeys([key])

      // Variant 11 with active mutation is preserved
      expect(getPerCaseByVariantId(1, 11, key)?.starred).toBe(1)
      expect(inFlightMutations.get(slotKey11)?.length).toBe(1)
      expect(confirmedBases.has(slotKey11)).toBe(true)
      expect(confirmedFieldPatches.get(slotKey11)?.star).toEqual({ starred: 1 })

      // Variant 12 without in-flight mutation is dropped
      expect(getPerCaseByVariantId(1, 12, key)).toBeUndefined()
    })

    it('2B: storeLoaded and loadBatch maintain row-specific in-flight optimistic state during sibling loads', async () => {
      beginAnnotationRequest(1, 'GRCh38')
      const d = defer<CaseVariantAnnotation>()
      vi.mocked(api.annotations.upsertPerCase).mockReturnValue(d.promise as never)
      vi.mocked(api.annotations.batchGet).mockResolvedValue({
        [key]: { global: null, perCase: mockPerCase(12, { starred: 0 }) }
      } as never)

      cacheSet(key, { global: null, perCase: mockPerCase(11, { starred: 0 }) })
      ensurePerCaseSlotOwner(key, 1, 11)
      setPerCaseByVariantId(1, 11, mockPerCase(11, { starred: 0 }), key)

      const ops = createScopedAnnotationOps(api, () => undefined)
      const pStar = ops.toggleStar(scope, coords)

      expect(getPerCaseByVariantId(1, 11, key)?.starred).toBe(1)

      // Sibling 12 is loaded via loadBatch
      const siblingScope = { kind: 'case' as const, caseId: 1, variantId: 12, build: 'GRCh38' }
      await ops.loadBatch(siblingScope, [{ id: 12, ...coords, is_starred: false }])

      // Variant 11's in-flight optimistic star state must remain intact
      expect(getPerCaseByVariantId(1, 11, key)?.starred).toBe(1)

      d.resolve(mockPerCase(11, { starred: 1 }))
      await pStar

      expect(getPerCaseByVariantId(1, 11, key)?.starred).toBe(1)
    })
  })

  // Defect 3: Failed edits remain in row-specific cache
  describe('Defect 3: Failed edits remain in row-specific cache', () => {
    it('3A: failed edit rolls back perCaseByVariantId even when slot ownership in annotationCache was stolen by sibling row', async () => {
      beginAnnotationRequest(1, 'GRCh38')
      cacheSet(key, { global: null, perCase: mockPerCase(11, { starred: 0 }) })
      ensurePerCaseSlotOwner(key, 1, 11)
      setPerCaseByVariantId(1, 11, mockPerCase(11, { starred: 0 }), key)

      const d = defer<CaseVariantAnnotation>()
      vi.mocked(api.annotations.upsertPerCase).mockReturnValue(d.promise as never)

      const ops = createScopedAnnotationOps(api, () => undefined)
      const pStar = ops.toggleStar(scope, coords)

      // Optimistic star applied to perCaseByVariantId
      expect(getPerCaseByVariantId(1, 11, key)?.starred).toBe(1)

      // Sibling 12 takes ownership of coordinate slot in annotationCache
      cacheSet(key, { global: null, perCase: mockPerCase(12, { starred: 0 }) })
      ensurePerCaseSlotOwner(key, 1, 12)
      setPerCaseByVariantId(1, 12, mockPerCase(12, { starred: 0 }), key)

      // Sibling 11's write fails
      d.reject(new Error('Network failure'))
      const result = await pStar
      expect(result).toBe(false)

      // Row 11 perCaseByVariantId MUST be rolled back to starred: 0
      expect(getPerCaseByVariantId(1, 11, key)?.starred).toBe(0)
      // Sibling 12 in annotationCache is untouched
      expect(annotationCache.value.get(key)?.perCase?.variant_id).toBe(12)
    })
  })

  // Defect 4: Shortlist failure handling rolls back unrelated pending edits
  describe('Defect 4: Shortlist failure handling rolls back unrelated pending edits', () => {
    it('4A: ShortlistPanel toggleStar failure preserves unrelated pending in-flight mutations and does not wipe confirmedBases', async () => {
      const row = minimalRow({ id: 11, case_id: 1, is_starred: false })
      const slotKey = perCaseSlotKey(1, 11, key)
      beginAnnotationRequest(1, 'GRCh38')
      ensurePerCaseSlotOwner(key, 1, 11)
      cacheSet(key, {
        global: null,
        perCase: mockPerCase(11, { starred: 0, acmg_classification: 'Pathogenic' })
      })
      setPerCaseByVariantId(
        1,
        11,
        mockPerCase(11, { starred: 0, acmg_classification: 'Pathogenic' }),
        key
      )

      // An unrelated ACMG mutation is already in flight on this slot
      const acmgMutId = allocateMutationId()
      inFlightMutations.set(slotKey, [
        {
          id: acmgMutId,
          fieldGroup: 'acmg',
          writeVer: 1,
          patch: { acmg_classification: 'Pathogenic' }
        }
      ])
      confirmedBases.set(slotKey, mockPerCase(11, { starred: 0, acmg_classification: 'Benign' }))
      confirmedFieldPatches.set(slotKey, { acmg: { acmg_classification: 'Pathogenic' } })

      const dStar = defer<CaseVariantAnnotation>()
      vi.mocked(api.annotations.upsertPerCase).mockReturnValue(dStar.promise as never)

      shortlistState.result.value = {
        rows: [row],
        totalCandidates: 1,
        presetUsed: null,
        elapsedMs: 5
      }

      const wrapper = mountShortlist(1)
      await flushPromises()
      const table = wrapper.findComponent({ name: 'ShortlistTable' })
      await table.vm.$emit('toggle-star', row)

      // Both star and ACMG are in flight
      expect(inFlightMutations.get(slotKey)?.length).toBe(2)

      // Star request fails
      dStar.reject(new Error('Star update failed'))
      await flushPromises()

      // The ACMG mutation must remain in flight
      const remaining = inFlightMutations.get(slotKey)
      expect(remaining?.length).toBe(1)
      expect(remaining?.[0].id).toBe(acmgMutId)
      expect(confirmedBases.has(slotKey)).toBe(true)
      expect(confirmedFieldPatches.get(slotKey)?.acmg).toBeDefined()

      // The optimistic state in perCaseByVariantId must still have acmg_classification: 'Pathogenic' and starred: 0
      expect(getPerCaseByVariantId(1, 11, key)?.acmg_classification).toBe('Pathogenic')
      expect(getPerCaseByVariantId(1, 11, key)?.starred).toBe(0)
    })

    it('4B: ShortlistPanel toggleStar failure after database switch does not roll back new database cache', async () => {
      const row = minimalRow({ id: 11, case_id: 1, is_starred: false })
      beginAnnotationRequest(1, 'GRCh38')
      ensurePerCaseSlotOwner(key, 1, 11)
      cacheSet(key, { global: null, perCase: mockPerCase(11, { starred: 0 }) })
      setPerCaseByVariantId(1, 11, mockPerCase(11, { starred: 0 }), key)

      const dStar = defer<CaseVariantAnnotation>()
      vi.mocked(api.annotations.upsertPerCase).mockReturnValue(dStar.promise as never)

      shortlistState.result.value = {
        rows: [row],
        totalCandidates: 1,
        presetUsed: null,
        elapsedMs: 5
      }

      const wrapper = mountShortlist(1)
      await flushPromises()
      const table = wrapper.findComponent({ name: 'ShortlistTable' })
      await table.vm.$emit('toggle-star', row)

      // User switches database while request is in flight
      const db = useDatabaseStore()
      db.currentPath = '/data/other.db'
      beginAnnotationRequest(1, 'GRCh38')
      cacheSet(key, {
        global: null,
        perCase: mockPerCase(11, { starred: 1, acmg_classification: 'Pathogenic' })
      })
      setPerCaseByVariantId(
        1,
        11,
        mockPerCase(11, { starred: 1, acmg_classification: 'Pathogenic' }),
        key
      )

      // Old database star request fails
      dStar.reject(new Error('Old DB request failed'))
      await flushPromises()

      // New database cache and perCaseByVariantId must NOT be rolled back
      expect(getPerCaseByVariantId(1, 11, key)?.starred).toBe(1)
      expect(annotationCache.value.get(key)?.perCase?.starred).toBe(1)
    })
  })

  // Round 24 Dual Review edge case regression tests
  describe('Round 24 regression defects', () => {
    it('Problem 1A: evictAnnotationCacheKeysForBulkTriage prunes in-flight mutation on sibling row and cleans stale perCaseByVariantId', () => {
      beginAnnotationRequest(1, 'GRCh38')
      const slotKey11 = perCaseSlotKey(1, 11, key)
      const mutId11 = allocateMutationId()
      inFlightMutations.set(slotKey11, [
        {
          id: mutId11,
          fieldGroup: 'acmg',
          writeVer: 1,
          patch: { acmg_classification: 'Likely pathogenic' }
        }
      ])
      confirmedBases.set(slotKey11, mockPerCase(11, { acmg_classification: 'Benign' }))
      confirmedFieldPatches.set(slotKey11, { acmg: { acmg_classification: 'Likely pathogenic' } })
      setPerCaseByVariantId(
        1,
        11,
        mockPerCase(11, { acmg_classification: 'Likely pathogenic' }),
        key
      )

      // Sibling 12 owns the slot in cache
      cacheSet(key, { global: null, perCase: mockPerCase(12) })
      ensurePerCaseSlotOwner(key, 1, 12)
      setPerCaseByVariantId(1, 12, mockPerCase(12), key)

      // Evict for bulk triage with bulk write version 5 for ACMG
      const bulkVerMap = new Map<string, Map<string, number>>([
        [key, new Map([['perCase:acmg', 5]])]
      ])
      const bulkOwners = new Map([
        [
          key,
          [
            { caseId: 1, variantId: 11 },
            { caseId: 1, variantId: 12 }
          ]
        ]
      ])

      evictAnnotationCacheKeysForBulkTriage(
        [key],
        ['acmg'],
        bulkVerMap,
        { acmg_classification: 'Pathogenic' },
        bulkOwners,
        true
      )

      // Row 11 mutation was superseded/pruned by bulkVer 5
      expect(inFlightMutations.get(slotKey11)?.length ?? 0).toBe(0)
      // Row 11 perCaseByVariantId must NOT retain the stale 'Likely pathogenic' mutation
      expect(getPerCaseByVariantId(1, 11, key)).toBeUndefined()
    })

    it('Problem 1B: reloadAffectedAndPanel retains both sibling variants at same coords in reload batch', async () => {
      beginAnnotationRequest(1, 'GRCh38')
      cacheSet(key, { global: null, perCase: mockPerCase(12) })
      ensurePerCaseSlotOwner(key, 1, 12)

      const eff = effectScope()
      const app = createApp({})
      app.provide(AppStateKey, {
        selectedPanelVariant: ref({ id: 12, case_id: 1, ...coords }),
        selectedCaseId: ref(1)
      })

      const requestedVariantIds: number[] = []
      vi.mocked(api.annotations.batchUpsertPerCase).mockResolvedValue({ updatedCount: 2 } as never)
      vi.mocked(api.annotations.batchGet).mockImplementation((_cid, keys) => {
        for (const k of keys as Array<{ variantId?: number }>) {
          if (typeof k.variantId === 'number') requestedVariantIds.push(k.variantId)
        }
        return Promise.resolve({
          [key]: { global: null, perCase: mockPerCase(12, { acmg_classification: 'Pathogenic' }) }
        }) as never
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

      // Both sibling variant 11 and panel variant 12 must be requested in reload
      expect(requestedVariantIds).toContain(11)
      expect(requestedVariantIds).toContain(12)
      eff.stop()
    })

    it('Problem 2.1: sibling variant with siblingOccupied reads base starred state from perCaseByVariantId and unstars correctly', async () => {
      beginAnnotationRequest(1, 'GRCh38')
      // Sibling 12 occupies annotationCache slot
      cacheSet(key, { global: null, perCase: mockPerCase(12, { starred: 1 }) })
      ensurePerCaseSlotOwner(key, 1, 12)
      setPerCaseByVariantId(1, 12, mockPerCase(12, { starred: 1 }), key)

      // Sibling 11 is in perCaseByVariantId with starred: 1
      setPerCaseByVariantId(1, 11, mockPerCase(11, { starred: 1 }), key)

      const d = defer<CaseVariantAnnotation>()
      vi.mocked(api.annotations.upsertPerCase).mockReturnValue(d.promise as never)

      const ops = createScopedAnnotationOps(api, () => undefined)
      // Toggle star on sibling 11 (which is currently starred)
      const siblingScope11 = { kind: 'case' as const, caseId: 1, variantId: 11, build: 'GRCh38' }
      const pToggle = ops.toggleStar(siblingScope11, coords)

      // Should send updates: { starred: false } because it was starred: 1
      expect(api.annotations.upsertPerCase).toHaveBeenCalledWith(1, 11, { starred: false })

      d.resolve(mockPerCase(11, { starred: 0 }))
      await pToggle
      expect(getPerCaseByVariantId(1, 11, key)?.starred).toBe(0)
    })

    it('Problem 2.2: failed edit on siblingOccupied variant rolls back perCaseByVariantId to base state', async () => {
      beginAnnotationRequest(1, 'GRCh38')
      // Sibling 12 occupies annotationCache slot
      cacheSet(key, { global: null, perCase: mockPerCase(12, { starred: 0 }) })
      ensurePerCaseSlotOwner(key, 1, 12)
      setPerCaseByVariantId(1, 12, mockPerCase(12, { starred: 0 }), key)

      // Sibling 11 has acmg_classification: 'Benign' in perCaseByVariantId
      setPerCaseByVariantId(1, 11, mockPerCase(11, { acmg_classification: 'Benign' }), key)

      const d = defer<CaseVariantAnnotation>()
      vi.mocked(api.annotations.upsertPerCase).mockReturnValue(d.promise as never)

      const ops = createScopedAnnotationOps(api, () => undefined)
      const siblingScope11 = { kind: 'case' as const, caseId: 1, variantId: 11, build: 'GRCh38' }
      const pEdit = ops.setAcmgClassification(siblingScope11, coords, 'Pathogenic')

      // Optimistic edit applied
      expect(getPerCaseByVariantId(1, 11, key)?.acmg_classification).toBe('Pathogenic')

      // Write rejects
      d.reject(new Error('Update failed'))
      const ok = await pEdit
      expect(ok).toBe(false)

      // Must roll back to 'Benign'
      expect(getPerCaseByVariantId(1, 11, key)?.acmg_classification).toBe('Benign')
      // Sibling 12 in annotationCache is untouched
      expect(annotationCache.value.get(key)?.perCase?.variant_id).toBe(12)
    })
  })
})
