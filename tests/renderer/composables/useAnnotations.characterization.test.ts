/**
 * Characterization tests for useAnnotations (issue #446).
 *
 * Pins the observable behaviour of every function the composable returns, in
 * both the per-case and the global scope, so the per-scope duplication can be
 * collapsed into one implementation without changing behaviour. Each
 * scenario records a trace — IPC calls, the cache while the request is in
 * flight, the cache afterwards, reactivity triggers and log calls — and
 * snapshots it.
 *
 * Do NOT update the snapshot to make a refactor pass — a diff here means
 * behaviour changed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { watch } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '../../utils/test-helpers'
import { createMockApi } from '../../utils/mock-api'
import * as annotationsModule from '@renderer/composables/useAnnotations'
import {
  useAnnotations,
  annotationCache,
  _resetAnnotationsForTesting
} from '@renderer/composables/useAnnotations'
import { logService } from '@renderer/services/LogService'
import { useDatabaseStore } from '@renderer/stores/databaseStore'
import { useSettingsStore } from '@renderer/stores/settingsStore'

type Annotations = ReturnType<typeof useAnnotations>
type Scope = 'case' | 'global'
type CacheEntry = NonNullable<ReturnType<Annotations['getAnnotations']>>

const V = ['chr1', 100, 'A', 'G'] as const
const KEY = 'chr1:100:A:G'
const V2 = ['chr2', 200, 'C', 'T'] as const
const KEY2 = 'chr2:200:C:T'
const CASE_ID = 1
const VARIANT_ID = 11
const SCOPES: Scope[] = ['case', 'global']

interface Deferred {
  promise: Promise<unknown>
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
}

function deferred(): Deferred {
  let resolve!: (value: unknown) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res
    reject = rej
  })
  // A skipped (already cached) load never consumes the promise; keep a
  // rejection from surfacing as an unhandled rejection in that case.
  promise.catch(() => {})
  return { promise, resolve, reject }
}

function populatedEntry(): CacheEntry {
  return {
    global: {
      id: 5,
      chr: 'chr1',
      pos: 100,
      ref: 'A',
      alt: 'G',
      starred: 1,
      acmg_classification: 'Benign',
      acmg_evidence: '{"BA1":true}',
      global_comment: 'old global'
    },
    perCase: {
      id: 6,
      case_id: CASE_ID,
      variant_id: VARIANT_ID,
      starred: 1,
      acmg_classification: 'Likely benign',
      acmg_evidence: '{"BS1":true}',
      per_case_comment: 'old case'
    }
  } as unknown as CacheEntry
}

const SEEDS = {
  uncached: () => undefined,
  'cached-empty': () => ({ global: null, perCase: null }) as CacheEntry,
  'cached-populated': populatedEntry
}
type SeedName = keyof typeof SEEDS

function cacheDump(): Array<[string, unknown]> {
  return [...annotationCache.value.keys()]
    .sort()
    .map((key) => [key, structuredClone(annotationCache.value.get(key))])
}

/** Everything observable about one scenario. */
interface Trace {
  ipc: Record<string, unknown[][]>
  duringFlight?: unknown
  loadingDuringFlight?: boolean[]
  after: unknown
  loadingAfter?: boolean[]
  triggersBeforeSettle?: number
  triggers: number
  logs: { error: unknown[][]; warn: unknown[][] }
}

describe('useAnnotations characterization', () => {
  let a: Annotations
  let api: ReturnType<typeof createMockApi>
  let errorSpy: ReturnType<typeof vi.spyOn>
  let warnSpy: ReturnType<typeof vi.spyOn>
  let triggers = 0
  let stopWatch: () => void

  function setup(options: { pinia?: boolean; userName?: string } = {}): void {
    if (options.pinia !== false) {
      setActivePinia(createPinia())
      useDatabaseStore().currentPath = '/data/a.db'
      useSettingsStore().userName = options.userName ?? 'Dr Test'
    }
    a = useAnnotations()
  }

  function ipcCalls(): Record<string, unknown[][]> {
    const calls: Record<string, unknown[][]> = {}
    for (const [name, fn] of Object.entries(api.annotations)) {
      const mock = vi.mocked(fn as (...args: unknown[]) => unknown).mock
      if (mock.calls.length > 0) calls[name] = structuredClone(mock.calls)
    }
    return calls
  }

  function logs(): Trace['logs'] {
    return { error: errorSpy.mock.calls, warn: warnSpy.mock.calls }
  }

  /** Establish lastCaseId = CASE_ID the way the app does: a per-case load. */
  async function primeCaseScope(): Promise<void> {
    await a.loadAnnotations(CASE_ID, 'chrP', 1, 'A', 'A')
    await flushPromises()
    annotationCache.value.delete('chrP:1:A:A')
    for (const fn of Object.values(api.annotations)) vi.mocked(fn).mockClear()
    triggers = 0
  }

  beforeEach(() => {
    setActivePinia(undefined as never)
    _resetAnnotationsForTesting()
    api = createMockApi()
    window.api = api as unknown as typeof window.api
    errorSpy = vi.spyOn(logService, 'error').mockImplementation(() => {})
    warnSpy = vi.spyOn(logService, 'warn').mockImplementation(() => {})
    triggers = 0
    stopWatch = watch(annotationCache, () => triggers++, { flush: 'sync' })
  })

  afterEach(() => {
    stopWatch()
    vi.restoreAllMocks()
    setActivePinia(undefined as never)
  })

  // ── Public surface ──────────────────────────────────────────────

  it('pins the module exports and the composable return shape', () => {
    setup()
    expect(Object.keys(annotationsModule).sort()).toMatchSnapshot()
    expect(Object.keys(a)).toMatchSnapshot()
    expect(Object.values(a).every((fn) => typeof fn === 'function')).toBe(true)
  })

  // ── Getters ─────────────────────────────────────────────────────

  describe('getters', () => {
    function readAll(): Record<string, unknown> {
      return {
        getAnnotations: structuredClone(a.getAnnotations(...V)),
        isStarred: a.isStarred(...V),
        isGlobalStarred: a.isGlobalStarred(...V),
        isLoading: a.isLoading(...V),
        getAcmgClassification: a.getAcmgClassification(...V),
        getGlobalAcmgClassification: a.getGlobalAcmgClassification(...V),
        getPerCaseComment: a.getPerCaseComment(...V),
        getGlobalComment: a.getGlobalComment(...V),
        getAcmgEvidence: a.getAcmgEvidence(...V),
        getGlobalAcmgEvidence: a.getGlobalAcmgEvidence(...V)
      }
    }

    it.each(Object.keys(SEEDS) as SeedName[])('read %s entry', (seed) => {
      setup()
      const entry = SEEDS[seed]()
      if (entry) annotationCache.value.set(KEY, entry)
      expect(readAll()).toMatchSnapshot()
    })

    it('treats starred = 0 and missing fields as unset', () => {
      setup()
      annotationCache.value.set(KEY, {
        global: { starred: 0 },
        perCase: { starred: 0 }
      } as unknown as CacheEntry)
      expect(readAll()).toMatchSnapshot()
    })
  })

  // ── Mutations (both scopes) ─────────────────────────────────────

  const MUTATIONS: Record<string, Record<Scope, (x: Annotations) => Promise<void>>> = {
    toggleStar: {
      case: (x) => x.toggleStar(CASE_ID, VARIANT_ID, ...V),
      global: (x) => x.toggleGlobalStar(...V)
    },
    setAcmg: {
      case: (x) => x.setAcmgClassification(CASE_ID, VARIANT_ID, ...V, 'Pathogenic'),
      global: (x) => x.setGlobalAcmgClassification(...V, 'Pathogenic')
    },
    clearAcmg: {
      case: (x) => x.setAcmgClassification(CASE_ID, VARIANT_ID, ...V, null),
      global: (x) => x.setGlobalAcmgClassification(...V, null)
    },
    upsertComment: {
      case: (x) => x.upsertPerCaseComment(CASE_ID, VARIANT_ID, ...V, 'new note'),
      global: (x) => x.upsertGlobalComment(...V, 'new note')
    },
    deleteComment: {
      case: (x) => x.deletePerCaseComment(CASE_ID, VARIANT_ID, ...V),
      global: (x) => x.deleteGlobalComment(...V)
    },
    setAcmgWithEvidence: {
      case: (x) =>
        x.setAcmgClassificationWithEvidence(
          CASE_ID,
          VARIANT_ID,
          ...V,
          'Likely pathogenic',
          '{"PVS1":true}'
        ),
      global: (x) =>
        x.setGlobalAcmgClassificationWithEvidence(...V, 'Likely pathogenic', '{"PVS1":true}')
    }
  }

  const OUTCOMES = ['resolve', 'reject', 'ipcError', 'dbSwitch', 'caseSwitch'] as const
  type Outcome = (typeof OUTCOMES)[number]

  async function settle(outcome: Outcome, pending: Deferred, value: unknown): Promise<void> {
    if (outcome === 'reject') return pending.reject(new Error('boom'))
    if (outcome === 'ipcError') {
      return pending.resolve({ code: 'E_TEST', message: 'raw message', userMessage: 'friendly' })
    }
    if (outcome === 'dbSwitch') useDatabaseStore().currentPath = '/data/b.db'
    if (outcome === 'caseSwitch') {
      // Another per-case call for a different case: its synchronous prefix
      // clears the cache and moves lastCaseId. It is awaited only after the
      // pending request settles, because a skipped (already cached) load
      // leaves the pending promise queued for this call's own IPC.
      const switched = a.loadAnnotations(2, 'chr9', 9, 'C', 'T')
      pending.resolve(value)
      return switched
    }
    pending.resolve(value)
  }

  async function traceMutation(
    op: string,
    scope: Scope,
    seed: SeedName,
    outcome: Outcome
  ): Promise<Trace> {
    setup()
    await primeCaseScope()
    const entry = SEEDS[seed]()
    if (entry) annotationCache.value.set(KEY, entry)

    const pending = deferred()
    const upsert = scope === 'case' ? api.annotations.upsertPerCase : api.annotations.upsertGlobal
    vi.mocked(upsert).mockReturnValue(pending.promise as never)

    const done = MUTATIONS[op][scope](a)
    const duringFlight = structuredClone(annotationCache.value.get(KEY))
    const triggersBeforeSettle = triggers
    const ipc = ipcCalls()

    await settle(outcome, pending, { from: 'server', scope })
    await done
    await flushPromises()

    return { ipc, duringFlight, after: cacheDump(), triggersBeforeSettle, triggers, logs: logs() }
  }

  describe.each(Object.keys(MUTATIONS))('mutation %s', (op) => {
    describe.each(SCOPES)('scope %s', (scope) => {
      const cases = (Object.keys(SEEDS) as SeedName[]).flatMap((seed) =>
        OUTCOMES.map((outcome) => [seed, outcome] as const)
      )
      it.each(cases)('%s / %s', async (seed, outcome) => {
        expect(await traceMutation(op, scope, seed, outcome)).toMatchSnapshot()
      })
    })
  })

  describe.each(SCOPES)('mutations without Pinia, scope %s', (scope) => {
    it.each(Object.keys(MUTATIONS))('%s omits user_name and skips the db guard', async (op) => {
      setup({ pinia: false })
      annotationCache.value.set(KEY, populatedEntry())
      const upsert = scope === 'case' ? api.annotations.upsertPerCase : api.annotations.upsertGlobal
      vi.mocked(upsert).mockResolvedValue({ from: 'server', scope } as never)
      await MUTATIONS[op][scope](a)
      await flushPromises()
      expect({ ipc: ipcCalls(), after: cacheDump(), triggers, logs: logs() }).toMatchSnapshot()
    })
  })

  it.each(SCOPES)('evidence save sends an empty user name as undefined (%s)', async (scope) => {
    setup({ userName: '' })
    await MUTATIONS.setAcmgWithEvidence[scope](a)
    expect(ipcCalls()).toMatchSnapshot()
  })

  it.each(SCOPES)('non-Error rejections are stringified in the log (%s)', async (scope) => {
    setup()
    const upsert = scope === 'case' ? api.annotations.upsertPerCase : api.annotations.upsertGlobal
    vi.mocked(upsert).mockRejectedValue('plain string')
    for (const op of Object.keys(MUTATIONS)) await MUTATIONS[op][scope](a)
    expect(logs()).toMatchSnapshot()
  })

  // ── Loads (both scopes) ─────────────────────────────────────────

  const BATCH = [
    { chr: V[0], pos: V[1], ref: V[2], alt: V[3], extra: 'dropped' },
    { chr: V2[0], pos: V2[1], ref: V2[2], alt: V2[3] }
  ]

  const LOADS: Record<
    string,
    Record<Scope, { run: (x: Annotations) => Promise<void>; ipc: string; value: unknown }>
  > = {
    single: {
      case: {
        run: (x) => x.loadAnnotations(CASE_ID, ...V),
        ipc: 'getForVariant',
        value: { global: { starred: 1 }, perCase: { starred: 0, per_case_comment: 'c' } }
      },
      global: {
        run: (x) => x.loadGlobalAnnotations(...V),
        ipc: 'getGlobal',
        value: { starred: 1, global_comment: 'g' }
      }
    },
    batch: {
      case: {
        run: (x) => x.loadAnnotationsBatch(CASE_ID, BATCH),
        ipc: 'batchGet',
        value: {
          [KEY]: { global: null, perCase: { starred: 1 } },
          [KEY2]: { global: { starred: 1 }, perCase: null }
        }
      },
      global: {
        run: (x) => x.loadGlobalAnnotationsBatch(BATCH),
        ipc: 'batchGet',
        value: {
          [KEY]: { global: { starred: 1 }, perCase: null },
          [KEY2]: { global: null, perCase: null }
        }
      }
    }
  }

  const LOAD_OUTCOMES = [...OUTCOMES, 'generationInvalidated'] as const
  type LoadOutcome = (typeof LOAD_OUTCOMES)[number]
  const LOAD_SEEDS = ['uncached', 'first-cached', 'all-cached'] as const

  function loadingFlags(): boolean[] {
    return [a.isLoading(...V), a.isLoading(...V2)]
  }

  async function traceLoad(
    kind: string,
    scope: Scope,
    seed: (typeof LOAD_SEEDS)[number],
    outcome: LoadOutcome
  ): Promise<Trace> {
    setup()
    await primeCaseScope()
    if (seed !== 'uncached') annotationCache.value.set(KEY, populatedEntry())
    if (seed === 'all-cached') annotationCache.value.set(KEY2, populatedEntry())

    const load = LOADS[kind][scope]
    const pending = deferred()
    const mock = api.annotations[load.ipc as keyof typeof api.annotations]
    vi.mocked(mock).mockReturnValueOnce(pending.promise as never)

    const done = load.run(a)
    const loadingDuringFlight = loadingFlags()
    const duringFlight = cacheDump()
    const triggersBeforeSettle = triggers

    if (outcome === 'generationInvalidated') {
      a.invalidateAnnotationGeneration()
      pending.resolve(load.value)
    } else {
      await settle(outcome, pending, load.value)
    }
    await done
    await flushPromises()

    return {
      ipc: ipcCalls(),
      duringFlight,
      loadingDuringFlight,
      after: cacheDump(),
      loadingAfter: loadingFlags(),
      triggersBeforeSettle,
      triggers,
      logs: logs()
    }
  }

  describe.each(Object.keys(LOADS))('load %s', (kind) => {
    describe.each(SCOPES)('scope %s', (scope) => {
      const cases = LOAD_SEEDS.flatMap((seed) =>
        LOAD_OUTCOMES.map((outcome) => [seed, outcome] as const)
      )
      it.each(cases)('%s / %s', async (seed, outcome) => {
        expect(await traceLoad(kind, scope, seed, outcome)).toMatchSnapshot()
      })
    })
  })

  describe.each(Object.keys(LOADS))('load %s de-duplication', (kind) => {
    it.each(SCOPES)('a second %s call while in flight issues no extra IPC', async (scope) => {
      setup()
      const load = LOADS[kind][scope]
      const pending = deferred()
      const mock = api.annotations[load.ipc as keyof typeof api.annotations]
      vi.mocked(mock).mockReturnValue(pending.promise as never)

      const first = load.run(a)
      const second = load.run(a)
      await second
      expect(vi.mocked(mock)).toHaveBeenCalledTimes(1)
      pending.resolve(load.value)
      await first
      await flushPromises()
      expect({ after: cacheDump(), loadingAfter: loadingFlags(), triggers }).toMatchSnapshot()
    })
  })

  it('an empty batch issues no IPC in either scope', async () => {
    setup()
    await a.loadAnnotationsBatch(CASE_ID, [])
    await a.loadGlobalAnnotationsBatch([])
    expect(ipcCalls()).toEqual({})
  })

  // ── Scope tracking and cache lifecycle ──────────────────────────

  describe('scope tracking', () => {
    async function seedViaCase(caseId: number): Promise<void> {
      await a.loadAnnotations(caseId, ...V)
      await flushPromises()
    }

    it('a different case id clears the cache; the same one does not', async () => {
      setup()
      await seedViaCase(1)
      await a.loadAnnotations(1, ...V2)
      expect(cacheDump().map(([key]) => key)).toEqual([KEY, KEY2])
      await a.loadAnnotations(2, 'chr3', 3, 'G', 'C')
      expect(cacheDump().map(([key]) => key)).toEqual(['chr3:3:G:C'])
    })

    it('global calls neither clear the cache nor move the tracked case', async () => {
      setup()
      await seedViaCase(1)
      await a.loadGlobalAnnotations(...V2)
      await a.toggleGlobalStar(...V2)
      await a.loadGlobalAnnotationsBatch([{ chr: 'chr4', pos: 4, ref: 'T', alt: 'A' }])
      await flushPromises()
      expect(cacheDump().map(([key]) => key)).toEqual([KEY, KEY2])
      // Still case 1: a per-case write for case 1 is applied, not discarded.
      vi.mocked(api.annotations.upsertPerCase).mockResolvedValue({ from: 'server' } as never)
      await a.toggleStar(1, VARIANT_ID, ...V)
      await flushPromises()
      expect(a.getAnnotations(...V)?.perCase).toEqual({ from: 'server' })
    })

    it.each(SCOPES)('a database switch clears the cache on the next %s call', async (scope) => {
      setup()
      await seedViaCase(1)
      useDatabaseStore().currentPath = '/data/b.db'
      if (scope === 'case') await a.loadAnnotations(1, ...V2)
      else await a.loadGlobalAnnotations(...V2)
      await flushPromises()
      expect(cacheDump().map(([key]) => key)).toEqual([KEY2])
    })

    it('clearCache empties the cache and forgets the tracked scope', async () => {
      setup()
      await seedViaCase(1)
      const before = triggers
      a.clearCache()
      expect(cacheDump()).toEqual([])
      expect(triggers - before).toBe(1)
      // Scope forgotten: a write for case 2 is no longer treated as a case switch.
      annotationCache.value.set(KEY, populatedEntry())
      await a.loadAnnotations(2, ...V2)
      expect(annotationCache.value.has(KEY)).toBe(true)
    })

    it('_resetAnnotationsForTesting clears cache, loading flags, scope and generation', async () => {
      setup()
      const pending = deferred()
      vi.mocked(api.annotations.getForVariant).mockReturnValueOnce(pending.promise as never)
      void a.loadAnnotations(1, ...V)
      expect(a.isLoading(...V)).toBe(true)
      _resetAnnotationsForTesting()
      expect(a.isLoading(...V)).toBe(false)
      expect(cacheDump()).toEqual([])
      pending.resolve({ global: null, perCase: null })
      await flushPromises()
    })
  })

  // ── No API available ────────────────────────────────────────────

  it('every async function is a silent no-op when window.api is missing', async () => {
    Reflect.deleteProperty(window, 'api')
    setup()
    annotationCache.value.set(KEY, populatedEntry())
    const before = cacheDump()
    for (const scope of SCOPES) {
      for (const op of Object.keys(MUTATIONS)) await MUTATIONS[op][scope](a)
      for (const kind of Object.keys(LOADS)) await LOADS[kind][scope].run(a)
    }
    await flushPromises()
    expect(cacheDump()).toEqual(before)
    expect(triggers).toBe(0)
    expect(logs()).toEqual({ error: [], warn: [] })
    expect(loadingFlags()).toEqual([false, false])
  })
})
