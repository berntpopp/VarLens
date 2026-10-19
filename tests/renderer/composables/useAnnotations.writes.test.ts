/**
 * Behaviour of optimistic annotation writes when the write does not land
 * where it started:
 * - a failed write must roll back AND tell watchers, in every operation and
 *   both scopes;
 * - a write that settles after a database or case switch must not touch the
 *   new scope's cache, nor leave its optimistic value in the old one.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, watch, effectScope, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMockApi } from '../../utils/mock-api'
import { useDatabaseStore } from '@renderer/stores/databaseStore'
import {
  useAnnotations,
  annotationCache,
  _resetAnnotationsForTesting
} from '@renderer/composables/useAnnotations'
import {
  confirmedBases,
  confirmedFieldPatches,
  ensurePerCaseSlotOwner,
  evictAnnotationCacheKeysForBulkTriage
} from '@renderer/composables/annotation-cache'
import {
  useBulkTriageSelection,
  _resetCommittedWriteListenersForTesting
} from '@renderer/composables/useBulkTriageSelection'
import { logService } from '@renderer/services/LogService'
import { AppStateKey, createAppState } from '@renderer/composables/useAppState'
import { BUILD_COPY } from '../../../src/shared/config/genome-builds.config'

type Annotations = ReturnType<typeof useAnnotations>

const V = ['chr1', 100, 'A', 'G'] as const
const KEY = 'chr1:100:A:G'
const CASE_ID = 1
const VARIANT_ID = 11

const WRITES: Record<string, (a: Annotations) => Promise<boolean>> = {
  toggleStar: (a) => a.toggleStar(CASE_ID, VARIANT_ID, ...V),
  toggleGlobalStar: (a) => a.toggleGlobalStar(...V),
  setAcmgClassification: (a) => a.setAcmgClassification(CASE_ID, VARIANT_ID, ...V, 'Pathogenic'),
  setGlobalAcmgClassification: (a) => a.setGlobalAcmgClassification(...V, 'Pathogenic'),
  upsertPerCaseComment: (a) => a.upsertPerCaseComment(CASE_ID, VARIANT_ID, ...V, 'note'),
  upsertGlobalComment: (a) => a.upsertGlobalComment(...V, 'note'),
  setAcmgClassificationWithEvidence: (a) =>
    a.setAcmgClassificationWithEvidence(CASE_ID, VARIANT_ID, ...V, 'Pathogenic', '{"PVS1":true}'),
  setGlobalAcmgClassificationWithEvidence: (a) =>
    a.setGlobalAcmgClassificationWithEvidence(...V, 'Pathogenic', '{"PVS1":true}')
}

const mockPerCase = (vid: number, extra: Record<string, unknown> = {}) => ({
  global: null,
  perCase: {
    id: 1,
    case_id: CASE_ID,
    variant_id: vid,
    starred: 0,
    acmg_classification: null,
    acmg_evidence: null,
    per_case_comment: null,
    created_at: 0,
    updated_at: 0,
    ...extra
  }
})

function seedEntry(): void {
  annotationCache.value.set(KEY, {
    global: {
      starred: 0,
      acmg_classification: 'Benign',
      acmg_evidence: '{"BA1":true}',
      global_comment: 'old'
    },
    perCase: {
      case_id: CASE_ID,
      variant_id: VARIANT_ID,
      starred: 0,
      acmg_classification: 'Benign',
      acmg_evidence: '{"BA1":true}',
      per_case_comment: 'old'
    }
  } as never)
}

describe('failed annotation writes roll back and notify watchers', () => {
  let triggers = 0
  let stopWatch: () => void

  beforeEach(() => {
    _resetAnnotationsForTesting()
    window.api = createMockApi()
    vi.spyOn(logService, 'error').mockImplementation(() => {})
    window.api.annotations.upsertPerCase = vi.fn().mockRejectedValue(new Error('boom'))
    window.api.annotations.upsertGlobal = vi.fn().mockRejectedValue(new Error('boom'))
    triggers = 0
    stopWatch = watch(annotationCache, () => triggers++, { flush: 'sync' })
  })

  afterEach(() => {
    stopWatch()
    vi.restoreAllMocks()
  })

  it.each(Object.keys(WRITES))('%s on a cached entry', async (name) => {
    seedEntry()
    const before = structuredClone(annotationCache.value.get(KEY))

    await WRITES[name](useAnnotations({ genomeBuild: 'GRCh38' }))

    // The optimistic value is gone ...
    expect(annotationCache.value.get(KEY)).toEqual(before)
    // ... and watchers were told: once for the optimistic write, once for the rollback.
    expect(triggers).toBe(2)
  })

  it.each(Object.keys(WRITES))('%s on an uncached entry', async (name) => {
    await WRITES[name](useAnnotations({ genomeBuild: 'GRCh38' }))

    expect(annotationCache.value.has(KEY)).toBe(false)
    expect(triggers).toBe(1)
  })

  // #486: a write that did not land must never look like a saved one.
  it.each(Object.keys(WRITES))('%s reports the failure to caller and user', async (name) => {
    seedEntry()
    const snacks: string[][] = []
    let a!: Annotations
    const state = createAppState()
    state.setSnackbarHandler((message, type) => snacks.push([message, type]))
    const app = createApp({ render: () => null })
    app.provide(AppStateKey, state)
    app.runWithContext(() => {
      a = useAnnotations({ genomeBuild: 'GRCh38' })
    })

    expect(await WRITES[name](a)).toBe(false)
    expect(snacks).toEqual([[expect.stringContaining('not saved'), 'error']])
  })
})

describe('global notes of a case whose build is not known (#577)', () => {
  it('are not sent, and the user is told to confirm the build', async () => {
    _resetAnnotationsForTesting()
    window.api = createMockApi()
    window.api.annotations.upsertGlobal = vi.fn()
    vi.spyOn(logService, 'error').mockImplementation(() => {})
    const snacks: string[][] = []
    const state = createAppState()
    state.setSnackbarHandler((message, type) => snacks.push([message, type]))
    const app = createApp({ render: () => null })
    app.provide(AppStateKey, state)
    let a!: Annotations
    app.runWithContext(() => {
      a = useAnnotations({ genomeBuild: 'my-build' })
    })

    expect(await a.toggleGlobalStar(...V)).toBe(false)
    expect(window.api.annotations.upsertGlobal).not.toHaveBeenCalled()
    expect(snacks).toEqual([[BUILD_COPY.globalNotesNeedBuild, 'error']])
    vi.restoreAllMocks()
  })
})

describe('successful annotation writes', () => {
  it.each(Object.keys(WRITES))('%s resolves true', async (name) => {
    _resetAnnotationsForTesting()
    window.api = createMockApi()
    window.api.annotations.upsertPerCase = vi.fn().mockResolvedValue({})
    window.api.annotations.upsertGlobal = vi.fn().mockResolvedValue({})

    expect(await WRITES[name](useAnnotations({ genomeBuild: 'GRCh38' }))).toBe(true)
  })
})

describe('annotation writes that resolve after the scope changed', () => {
  let a: Annotations
  let settle: { resolve: (value: unknown) => void; reject: (error: unknown) => void }
  const SERVER_ROW = { from: 'server' }

  beforeEach(() => {
    _resetAnnotationsForTesting()
    setActivePinia(createPinia())
    useDatabaseStore().currentPath = '/data/a.db'
    window.api = createMockApi()
    vi.spyOn(logService, 'error').mockImplementation(() => {})
    const pending = new Promise((resolve, reject) => {
      settle = { resolve, reject }
    })
    window.api.annotations.upsertPerCase = vi.fn().mockReturnValue(pending)
    window.api.annotations.upsertGlobal = vi.fn().mockReturnValue(pending)
    a = useAnnotations({ genomeBuild: 'GRCh38' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    setActivePinia(undefined as never)
  })

  /** Make CASE_ID the tracked case, as the case table does on its first load. */
  async function trackCase(caseId: number): Promise<void> {
    await a.loadAnnotations(caseId, 'chrP', 1, 'A', 'A')
    annotationCache.value.delete('chrP:1:A:A')
  }

  describe.each(['resolves', 'rejects'] as const)('database switch, then the write %s', (how) => {
    it.each(Object.keys(WRITES))('%s leaves no optimistic value behind', async (name) => {
      await trackCase(CASE_ID)
      seedEntry()
      const done = WRITES[name](a)
      expect(annotationCache.value.has(KEY)).toBe(true)

      // The user opens another database; nothing has queried annotations yet.
      useDatabaseStore().currentPath = '/data/b.db'
      if (how === 'resolves') settle.resolve(SERVER_ROW)
      else settle.reject(new Error('boom'))
      await done

      // Neither the optimistic value nor anything else of the old database is served.
      expect([...annotationCache.value.keys()]).toEqual([])
    })
  })

  it('a global write does not carry the previous case into the new case', async () => {
    await trackCase(CASE_ID)
    seedEntry()
    const done = a.toggleGlobalStar(...V)

    // Case switch: the table clears the cache and loads case 2, which has the
    // same variant with its own per-case annotation.
    a.clearCache()
    const caseTwoRow = { case_id: 2, variant_id: 22, starred: 1 }
    window.api.annotations.getForVariant = vi
      .fn()
      .mockResolvedValue({ global: { starred: 0 }, perCase: caseTwoRow })
    await a.loadAnnotations(2, ...V)
    settle.resolve(SERVER_ROW)
    await done

    expect(annotationCache.value.get(KEY)).toEqual({ global: SERVER_ROW, perCase: caseTwoRow })
  })

  it('a global write does not create an entry in the new case', async () => {
    await trackCase(CASE_ID)
    seedEntry()
    const done = a.toggleGlobalStar(...V)

    a.clearCache()
    await trackCase(2)
    settle.resolve(SERVER_ROW)
    await done

    expect(annotationCache.value.has(KEY)).toBe(false)
  })

  it('a per-case write for a case that was left is dropped', async () => {
    await trackCase(CASE_ID)
    seedEntry()
    const done = a.toggleStar(CASE_ID, VARIANT_ID, ...V)

    a.clearCache()
    const caseTwoEntry = { global: null, perCase: { case_id: 2, variant_id: 22, starred: 0 } }
    window.api.annotations.getForVariant = vi.fn().mockResolvedValue(caseTwoEntry)
    await a.loadAnnotations(2, ...V)
    settle.resolve(SERVER_ROW)
    await done

    expect(annotationCache.value.get(KEY)).toEqual(caseTwoEntry)
  })

  it('a per-case write that outlives leaving and re-entering its case resurrects nothing', async () => {
    await trackCase(CASE_ID)
    seedEntry()
    const done = a.toggleStar(CASE_ID, VARIANT_ID, ...V)

    // Leave the case and come back: the cache was rebuilt in between.
    a.clearCache()
    await trackCase(CASE_ID)
    settle.resolve(SERVER_ROW)
    await done

    // The reloaded cache does not hold this row, so nothing is recreated
    // from the entry that was cached before the switch.
    expect(annotationCache.value.has(KEY)).toBe(false)
  })
})

describe('overlapping mutations and rollback', () => {
  let a: Annotations
  let deferredAcmg: { resolve: (v: unknown) => void; reject: (e: unknown) => void }
  let deferredComment: { resolve: (v: unknown) => void; reject: (e: unknown) => void }

  beforeEach(() => {
    _resetAnnotationsForTesting()
    _resetCommittedWriteListenersForTesting()
    setActivePinia(createPinia())
    useDatabaseStore().currentPath = '/data/a.db'
    window.api = createMockApi()
    vi.spyOn(logService, 'error').mockImplementation(() => {})
    window.api.annotations.upsertPerCase = vi
      .fn()
      .mockImplementation((_cid: number, _vid: number, updates: Record<string, unknown>) => {
        if (updates.acmg_classification !== undefined) {
          return new Promise((resolve, reject) => {
            deferredAcmg = { resolve, reject }
          })
        }
        if (updates.per_case_comment !== undefined) {
          return new Promise((resolve, reject) => {
            deferredComment = { resolve, reject }
          })
        }
        return Promise.resolve({ from: 'server' })
      })
    a = useAnnotations({ genomeBuild: 'GRCh38' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    setActivePinia(undefined as never)
  })

  async function trackCase(caseId: number): Promise<void> {
    await a.loadAnnotations(caseId, 'chrP', 1, 'A', 'A')
    annotationCache.value.delete('chrP:1:A:A')
  }

  it('restores baseline when overlapping classification and comment writes both reject', async () => {
    seedEntry()
    const p1 = a.setAcmgClassification(CASE_ID, VARIANT_ID, ...V, 'Pathogenic')
    const p2 = a.upsertPerCaseComment(CASE_ID, VARIANT_ID, ...V, 'note')

    expect(annotationCache.value.get(KEY)?.perCase?.acmg_classification).toBe('Pathogenic')
    expect(annotationCache.value.get(KEY)?.perCase?.per_case_comment).toBe('note')

    deferredAcmg.reject(new Error('acmg write failed'))
    await p1

    expect(annotationCache.value.get(KEY)?.perCase?.acmg_classification).toBe('Benign')
    expect(annotationCache.value.get(KEY)?.perCase?.per_case_comment).toBe('note')

    deferredComment.reject(new Error('comment write failed'))
    await p2

    expect(annotationCache.value.get(KEY)?.perCase?.acmg_classification).toBe('Benign')
    expect(annotationCache.value.get(KEY)?.perCase?.per_case_comment).toBe('old')
  })

  it('restores baseline when two overlapping classification writes both reject', async () => {
    seedEntry()
    let deferred1!: { resolve: (v: unknown) => void; reject: (e: unknown) => void }
    let deferred2!: { resolve: (v: unknown) => void; reject: (e: unknown) => void }
    let call = 0
    window.api.annotations.upsertPerCase = vi.fn().mockImplementation(() => {
      call++
      if (call === 1) {
        return new Promise((resolve, reject) => {
          deferred1 = { resolve, reject }
        })
      }
      return new Promise((resolve, reject) => {
        deferred2 = { resolve, reject }
      })
    })

    const p1 = a.setAcmgClassification(CASE_ID, VARIANT_ID, ...V, 'VUS')
    const p2 = a.setAcmgClassification(CASE_ID, VARIANT_ID, ...V, 'Pathogenic')

    expect(annotationCache.value.get(KEY)?.perCase?.acmg_classification).toBe('Pathogenic')

    deferred1.reject(new Error('first failed'))
    await p1
    expect(annotationCache.value.get(KEY)?.perCase?.acmg_classification).toBe('Pathogenic')

    deferred2.reject(new Error('second failed'))
    await p2
    expect(annotationCache.value.get(KEY)?.perCase?.acmg_classification).toBe('Benign')
  })

  it('keeps newer classification when second write resolves first and older write rejects second', async () => {
    seedEntry()
    let deferred1!: { resolve: (v: unknown) => void; reject: (e: unknown) => void }
    let deferred2!: { resolve: (v: unknown) => void; reject: (e: unknown) => void }
    let call = 0
    window.api.annotations.upsertPerCase = vi.fn().mockImplementation(() => {
      call++
      if (call === 1) {
        return new Promise((resolve, reject) => {
          deferred1 = { resolve, reject }
        })
      }
      return new Promise((resolve, reject) => {
        deferred2 = { resolve, reject }
      })
    })

    const p1 = a.setAcmgClassification(CASE_ID, VARIANT_ID, ...V, 'Pathogenic')
    const p2 = a.setAcmgClassification(CASE_ID, VARIANT_ID, ...V, 'Likely pathogenic')

    expect(annotationCache.value.get(KEY)?.perCase?.acmg_classification).toBe('Likely pathogenic')

    // M2 resolves first
    deferred2.resolve({
      id: 6,
      case_id: CASE_ID,
      variant_id: VARIANT_ID,
      starred: 0,
      acmg_classification: 'Likely pathogenic',
      acmg_evidence: null,
      per_case_comment: 'old',
      created_at: 0,
      updated_at: 0
    })
    await p2

    expect(annotationCache.value.get(KEY)?.perCase?.acmg_classification).toBe('Likely pathogenic')

    // M1 rejects second
    deferred1.reject(new Error('M1 failed late'))
    await p1

    // Classification MUST stay 'Likely pathogenic', not rolled back to 'Benign'
    expect(annotationCache.value.get(KEY)?.perCase?.acmg_classification).toBe('Likely pathogenic')
  })

  it('preserves first write when first write succeeds and newer overlapping write fails', async () => {
    seedEntry()
    let deferred1!: { resolve: (v: unknown) => void; reject: (e: unknown) => void }
    let deferred2!: { resolve: (v: unknown) => void; reject: (e: unknown) => void }
    let call = 0
    window.api.annotations.upsertPerCase = vi.fn().mockImplementation(() => {
      call++
      if (call === 1) {
        return new Promise((resolve, reject) => {
          deferred1 = { resolve, reject }
        })
      }
      return new Promise((resolve, reject) => {
        deferred2 = { resolve, reject }
      })
    })

    const p1 = a.setAcmgClassification(CASE_ID, VARIANT_ID, ...V, 'Pathogenic')
    const p2 = a.setAcmgClassification(CASE_ID, VARIANT_ID, ...V, 'Likely pathogenic')
    expect(annotationCache.value.get(KEY)?.perCase?.acmg_classification).toBe('Likely pathogenic')

    // M1 resolves first with success
    deferred1.resolve({
      id: 6,
      case_id: CASE_ID,
      variant_id: VARIANT_ID,
      starred: 0,
      acmg_classification: 'Pathogenic',
      acmg_evidence: null,
      per_case_comment: 'old',
      created_at: 0,
      updated_at: 0
    })
    await p1

    expect(annotationCache.value.get(KEY)?.perCase?.acmg_classification).toBe('Likely pathogenic')

    // M2 rejects second
    deferred2.reject(new Error('M2 failed'))
    await p2

    // Classification MUST restore M1's confirmed 'Pathogenic', NOT roll back to 'Benign'
    expect(annotationCache.value.get(KEY)?.perCase?.acmg_classification).toBe('Pathogenic')
  })

  it('preserves comment when delayed ACMG response arrives second with older comment', async () => {
    seedEntry()
    let deferredAcmg!: { resolve: (v: unknown) => void; reject: (e: unknown) => void }
    let deferredComment!: { resolve: (v: unknown) => void; reject: (e: unknown) => void }
    window.api.annotations.upsertPerCase = vi.fn().mockImplementation((_cid, _vid, updates) => {
      if ('acmg_classification' in updates) {
        return new Promise((resolve, reject) => {
          deferredAcmg = { resolve, reject }
        })
      }
      return new Promise((resolve, reject) => {
        deferredComment = { resolve, reject }
      })
    })

    const pAcmg = a.setAcmgClassification(CASE_ID, VARIANT_ID, ...V, 'Pathogenic')
    const pComment = a.upsertPerCaseComment(CASE_ID, VARIANT_ID, ...V, 'new note')

    expect(annotationCache.value.get(KEY)?.perCase?.acmg_classification).toBe('Pathogenic')
    expect(annotationCache.value.get(KEY)?.perCase?.per_case_comment).toBe('new note')

    // Comment resolves first
    deferredComment.resolve({
      id: 6,
      case_id: CASE_ID,
      variant_id: VARIANT_ID,
      starred: 0,
      acmg_classification: 'Benign',
      acmg_evidence: null,
      per_case_comment: 'new note',
      created_at: 0,
      updated_at: 0
    })
    await pComment

    expect(annotationCache.value.get(KEY)?.perCase?.acmg_classification).toBe('Pathogenic')
    expect(annotationCache.value.get(KEY)?.perCase?.per_case_comment).toBe('new note')

    // Delayed ACMG response resolves second; server snapshot had stale comment: 'old'
    deferredAcmg.resolve({
      id: 6,
      case_id: CASE_ID,
      variant_id: VARIANT_ID,
      starred: 0,
      acmg_classification: 'Pathogenic',
      acmg_evidence: null,
      per_case_comment: 'old',
      created_at: 0,
      updated_at: 0
    })
    await pAcmg

    // Both Pathogenic and 'new note' MUST be preserved
    expect(annotationCache.value.get(KEY)?.perCase?.acmg_classification).toBe('Pathogenic')
    expect(annotationCache.value.get(KEY)?.perCase?.per_case_comment).toBe('new note')
  })

  it('isolates confirmed patches between sibling variants sharing coordinates on owner switch', async () => {
    await trackCase(CASE_ID)
    window.api.annotations.upsertPerCase = vi
      .fn()
      .mockResolvedValue(mockPerCase(11, { per_case_comment: 'variant 11 comment' }).perCase)
    await a.upsertPerCaseComment(CASE_ID, 11, ...V, 'variant 11 comment')
    expect(confirmedFieldPatches.get(`perCase:${KEY}`)?.comment).toBeUndefined()

    window.api.annotations.batchGet = vi.fn().mockResolvedValue({
      [KEY]: mockPerCase(12, { acmg_classification: 'Benign' })
    })
    await a.loadAnnotationsBatch(CASE_ID, [{ id: 12, chr: V[0], pos: V[1], ref: V[2], alt: V[3] }])

    expect(annotationCache.value.get(KEY)?.perCase?.variant_id).toBe(12)
    expect(annotationCache.value.get(KEY)?.perCase?.per_case_comment).toBeNull()
    expect(confirmedFieldPatches.get(`perCase:${KEY}`)?.comment).toBeUndefined()
  })

  it('preserves bulk ACMG when delayed single-row comment resolves with older server snapshot', async () => {
    await trackCase(CASE_ID)
    seedEntry()
    let deferredComment!: { resolve: (val: unknown) => void; reject: (err: unknown) => void }
    window.api.annotations.upsertPerCase = vi.fn().mockImplementation(() => {
      return new Promise((resolve, reject) => {
        deferredComment = { resolve, reject }
      })
    })

    const pComment = a.upsertPerCaseComment(CASE_ID, VARIANT_ID, ...V, 'new comment')
    expect(annotationCache.value.get(KEY)?.perCase?.per_case_comment).toBe('new comment')

    const bulkWriteVersions = new Map()
    evictAnnotationCacheKeysForBulkTriage([KEY], ['acmg'], bulkWriteVersions, {
      acmg_classification: 'Pathogenic'
    })

    window.api.annotations.batchGet = vi.fn().mockResolvedValue({
      [KEY]: mockPerCase(VARIANT_ID, {
        acmg_classification: 'Pathogenic',
        per_case_comment: 'old comment'
      })
    })
    await a.loadAnnotationsBatch(CASE_ID, [
      { id: VARIANT_ID, chr: V[0], pos: V[1], ref: V[2], alt: V[3] }
    ])

    expect(annotationCache.value.get(KEY)?.perCase?.acmg_classification).toBe('Pathogenic')
    expect(annotationCache.value.get(KEY)?.perCase?.per_case_comment).toBe('new comment')

    deferredComment.resolve(
      mockPerCase(VARIANT_ID, {
        acmg_classification: 'Benign',
        per_case_comment: 'new comment'
      }).perCase
    )
    await pComment

    expect(annotationCache.value.get(KEY)?.perCase?.acmg_classification).toBe('Pathogenic')
    expect(annotationCache.value.get(KEY)?.perCase?.per_case_comment).toBe('new comment')
  })

  it('rolls back failed comment to post-bulk state rather than obsolete pre-bulk base', async () => {
    await trackCase(CASE_ID)
    window.api.annotations.batchGet = vi.fn().mockResolvedValue({
      [KEY]: mockPerCase(VARIANT_ID, {
        acmg_classification: 'Benign',
        per_case_comment: 'initial note'
      })
    })
    await a.loadAnnotationsBatch(CASE_ID, [
      { id: VARIANT_ID, chr: V[0], pos: V[1], ref: V[2], alt: V[3] }
    ])
    expect(annotationCache.value.get(KEY)?.perCase?.acmg_classification).toBe('Benign')

    const bulkWriteVersions = new Map()
    evictAnnotationCacheKeysForBulkTriage([KEY], ['acmg'], bulkWriteVersions, {
      acmg_classification: 'Pathogenic'
    })

    window.api.annotations.batchGet = vi.fn().mockResolvedValue({
      [KEY]: mockPerCase(VARIANT_ID, {
        acmg_classification: 'Pathogenic',
        per_case_comment: 'initial note'
      })
    })
    await a.loadAnnotationsBatch(CASE_ID, [
      { id: VARIANT_ID, chr: V[0], pos: V[1], ref: V[2], alt: V[3] }
    ])
    expect(annotationCache.value.get(KEY)?.perCase?.acmg_classification).toBe('Pathogenic')
    expect(confirmedBases.has(`perCase:${KEY}`)).toBe(false)

    window.api.annotations.upsertPerCase = vi.fn().mockRejectedValue(new Error('Network error'))
    const ok = await a.upsertPerCaseComment(CASE_ID, VARIANT_ID, ...V, 'doomed comment')
    expect(ok).toBe(false)

    expect(annotationCache.value.get(KEY)?.perCase?.acmg_classification).toBe('Pathogenic')
    expect(annotationCache.value.get(KEY)?.perCase?.per_case_comment).toBe('initial note')
    expect(confirmedBases.has(`perCase:${KEY}`)).toBe(false)
  })

  it('does not roll back newly loaded cache entry when an older uncached single-row write fails', async () => {
    await trackCase(CASE_ID)
    const coords = ['chr1', 500, 'A', 'T'] as const
    const key = 'chr1:500:A:T'

    let deferredWrite!: { resolve: (val: unknown) => void; reject: (err: unknown) => void }
    window.api.annotations.upsertPerCase = vi.fn().mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          deferredWrite = { resolve, reject }
        })
    )

    const pWrite = a.toggleStar(CASE_ID, VARIANT_ID, ...coords)

    annotationCache.value.set(
      key,
      mockPerCase(VARIANT_ID, { starred: 1, acmg_classification: 'Benign' })
    )
    expect(annotationCache.value.get(key)?.perCase?.starred).toBe(1)

    deferredWrite.reject(new Error('Network failure'))
    const ok = await pWrite
    expect(ok).toBe(false)

    expect(annotationCache.value.get(key)?.perCase?.starred).toBe(1)
  })

  it('does not merge bulk patches of sibling variant 12 onto sibling variant 11 in panel', async () => {
    await trackCase(CASE_ID)
    const state = createAppState()
    const app = createApp({ render: () => null })
    app.provide(AppStateKey, state)
    state.selectedPanelVariant.value = {
      id: 11,
      case_id: CASE_ID,
      chr: V[0],
      pos: V[1],
      ref: V[2],
      alt: V[3]
    }

    annotationCache.value.set(KEY, mockPerCase(11, { acmg_classification: 'Benign' }))
    ensurePerCaseSlotOwner(KEY, CASE_ID, 11)

    const siblingItems = ref([{ id: 12, chr: V[0], pos: V[1], ref: V[2], alt: V[3] }])
    let deferredBulk!: { resolve: (val: unknown) => void; reject: (err: unknown) => void }
    let deferredBatchGet!: { resolve: (val: unknown) => void; reject: (err: unknown) => void }
    window.api.annotations.batchUpsertPerCase = vi.fn().mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          deferredBulk = { resolve, reject }
        })
    )
    window.api.annotations.batchGet = vi.fn().mockImplementation((_cid, variants) => {
      if (Array.isArray(variants) && variants.some((v) => v.variantId === 12)) {
        return Promise.resolve({ [KEY]: mockPerCase(12, { acmg_classification: 'Pathogenic' }) })
      }
      return new Promise((resolve, reject) => {
        deferredBatchGet = { resolve, reject }
      })
    })

    let bulkInstance!: ReturnType<typeof useBulkTriageSelection>
    app.runWithContext(() => {
      bulkInstance = useBulkTriageSelection({
        items: () => siblingItems.value,
        getItemId: (v: { id: number }) => v.id,
        caseId: CASE_ID
      })
    })

    bulkInstance.toggleSelect(12)
    const pTriage = bulkInstance.applyBulkTriage({ acmg_classification: 'Pathogenic' })

    deferredBulk.resolve({ updatedCount: 1 })
    await vi.waitFor(() => {
      expect(window.api.annotations.batchGet).toHaveBeenCalledWith(
        CASE_ID,
        [{ chr: V[0], pos: V[1], ref: V[2], alt: V[3], variantId: 11 }],
        null
      )
    })

    deferredBatchGet.resolve({ [KEY]: mockPerCase(11, { acmg_classification: 'Benign' }) })
    await pTriage

    expect(annotationCache.value.get(KEY)?.perCase?.variant_id).toBe(11)
    expect(annotationCache.value.get(KEY)?.perCase?.acmg_classification).toBe('Benign')
  })

  it('deduplicates sibling variants with same coords in loadBatch to avoid duplicate batchGet keys', async () => {
    await trackCase(CASE_ID)
    window.api.annotations.batchGet = vi.fn().mockResolvedValue({})
    await a.loadAnnotationsBatch(CASE_ID, [
      { id: 12, chr: V[0], pos: V[1], ref: V[2], alt: V[3] },
      { id: 13, chr: V[0], pos: V[1], ref: V[2], alt: V[3] }
    ])
    expect(window.api.annotations.batchGet).toHaveBeenCalledWith(
      CASE_ID,
      [{ chr: V[0], pos: V[1], ref: V[2], alt: V[3], variantId: 13 }],
      null
    )
  })

  it('notifies peer committedWriteListeners on normal bulk triage completion', async () => {
    await trackCase(CASE_ID)
    window.api.annotations.batchUpsertPerCase = vi.fn().mockResolvedValue({ updatedCount: 1 })
    window.api.annotations.batchGet = vi.fn().mockResolvedValue({})

    const peerOnTriageApplied = vi.fn()
    const peerScope = effectScope()
    peerScope.run(() => {
      useBulkTriageSelection({
        items: () => [{ id: 101, chr: V[0], pos: V[1], ref: V[2], alt: V[3] }],
        getItemId: (v: { id: number }) => v.id,
        caseId: CASE_ID,
        onTriageApplied: peerOnTriageApplied
      })
    })

    const onTriageApplied = vi.fn()
    const bulk = useBulkTriageSelection({
      items: () => [{ id: 101, chr: V[0], pos: V[1], ref: V[2], alt: V[3] }],
      getItemId: (v: { id: number }) => v.id,
      caseId: CASE_ID,
      onTriageApplied
    })
    bulk.toggleSelect(101)
    await bulk.applyBulkTriage({ starred: true })

    expect(onTriageApplied).toHaveBeenCalledTimes(1)
    expect(peerOnTriageApplied).toHaveBeenCalledTimes(1)
    peerScope.stop()
  })
})
