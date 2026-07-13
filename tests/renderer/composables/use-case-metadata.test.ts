/**
 * Tests for useCaseMetadata's write cluster: cohort create/assign
 * (createAndAssignCohort, getOrCreateCohort), HPO assign (assignHpoTerm),
 * and the affected-status/sex/age/dob metadata upsert paths.
 *
 * `wrapHandler` in the main process *resolves* an `IpcResult<T>` on failure
 * (it never rejects), so a raw `await api.caseMetadata.*` call stores a
 * `SerializableError` object as if it were data — and the optimistic-update
 * revert `catch` blocks never fire because nothing throws. Every
 * `api.caseMetadata.*` write result must be wrapped in `unwrapIpcResult(...)`
 * so a DB failure (e.g. a UNIQUE-constraint violation on a duplicate
 * cohort/HPO name) throws into the existing catch handler instead.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { withSetup, flushPromises } from '../../utils/test-helpers'
import { createMockApi } from '../../utils/mock-api'
import { useCaseMetadata } from '@renderer/composables/useCaseMetadata'
import type { CohortGroup, CaseHpoTerm, FullCaseMetadata } from '../../../src/shared/types/api'
import { logService } from '../../../src/renderer/src/services/LogService'

vi.mock('../../../src/renderer/src/services/LogService', () => ({
  logService: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    critical: vi.fn()
  }
}))

// Runtime shape of a main-process SerializableError (src/shared/types/errors.ts).
// `isIpcError` discriminates on the presence of `code`/`message`/`userMessage` —
// there is no `__isSerializableError` field.
const fakeSerializableError = {
  code: 'DB_ERROR',
  message: 'UNIQUE constraint failed: cohort_groups.name',
  userMessage: 'A cohort with this name already exists'
}

const fakeCohort: CohortGroup = {
  id: 42,
  name: 'Trio A',
  description: null,
  created_at: 1_700_000_000_000
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function makeFullMetadata(overrides: Partial<FullCaseMetadata> = {}): FullCaseMetadata {
  return {
    metadata: {
      id: 1,
      case_id: 1,
      affected_status: null,
      sex: null,
      notes: null,
      age: null,
      date_of_birth: null,
      created_at: 1_700_000_000_000,
      updated_at: 1_700_000_000_000
    },
    cohorts: [],
    hpoTerms: [],
    comments: [],
    metrics: [],
    dataInfo: null,
    externalIds: [],
    ...overrides
  }
}

describe('useCaseMetadata write cluster — IpcResult unwrapping', () => {
  let app: { unmount: () => void } | undefined

  beforeEach(() => {
    window.api = createMockApi()
    vi.clearAllMocks()
  })

  afterEach(() => {
    if (app) app.unmount()
    app = undefined
    // metadataCache/cohortGroupsCache are module-level singletons shared by
    // every useCaseMetadata() call — reset them so state from one test can't
    // leak into the next.
    useCaseMetadata().clearCache()
  })

  describe('createAndAssignCohort', () => {
    it('creates and assigns a cohort on success', async () => {
      window.api.caseMetadata.createCohort = vi.fn().mockResolvedValue(fakeCohort)
      window.api.caseMetadata.assignCohort = vi.fn().mockResolvedValue(undefined)

      const [result, appInstance] = withSetup(() => useCaseMetadata())
      app = appInstance

      const created = await result.createAndAssignCohort(1, 'Trio A')

      expect(created).toEqual(fakeCohort)
      expect(result.cohortGroupsCache.value).toContainEqual(fakeCohort)
      expect(window.api.caseMetadata.assignCohort).toHaveBeenCalledWith(1, 42)
    })

    it('rejects and does not store the SerializableError when createCohort fails (duplicate name)', async () => {
      window.api.caseMetadata.createCohort = vi.fn().mockResolvedValue(fakeSerializableError)
      window.api.caseMetadata.assignCohort = vi.fn().mockResolvedValue(undefined)

      const [result, appInstance] = withSetup(() => useCaseMetadata())
      app = appInstance

      await expect(result.createAndAssignCohort(1, 'dup')).rejects.toMatchObject({
        code: 'DB_ERROR'
      })

      // No error-shaped object may enter the global cohort cache.
      expect(result.cohortGroupsCache.value.some((c) => 'code' in c || 'userMessage' in c)).toBe(
        false
      )
      expect(result.cohortGroupsCache.value.length).toBe(0)
      // assignCohort must never run against an id that came from a failed create.
      expect(window.api.caseMetadata.assignCohort).not.toHaveBeenCalled()
    })

    it('rejects and leaves the case metadata cache untouched when assignCohort fails', async () => {
      window.api.caseMetadata.createCohort = vi.fn().mockResolvedValue(fakeCohort)
      window.api.caseMetadata.assignCohort = vi.fn().mockResolvedValue(fakeSerializableError)

      const [result, appInstance] = withSetup(() => useCaseMetadata())
      app = appInstance
      result.metadataCache.value.set(1, makeFullMetadata())

      await expect(result.createAndAssignCohort(1, 'Trio A')).rejects.toMatchObject({
        code: 'DB_ERROR'
      })

      const cached = result.metadataCache.value.get(1)
      expect(cached?.cohorts).toEqual([])
    })
  })

  describe('getOrCreateCohort', () => {
    it('returns the cached cohort without calling createCohort when the name already exists', async () => {
      window.api.caseMetadata.createCohort = vi.fn()

      const [result, appInstance] = withSetup(() => useCaseMetadata())
      app = appInstance
      result.cohortGroupsCache.value.push(fakeCohort)

      const found = await result.getOrCreateCohort('Trio A')

      expect(found).toEqual(fakeCohort)
      expect(window.api.caseMetadata.createCohort).not.toHaveBeenCalled()
    })

    it('creates and caches a new cohort on success', async () => {
      window.api.caseMetadata.createCohort = vi.fn().mockResolvedValue(fakeCohort)

      const [result, appInstance] = withSetup(() => useCaseMetadata())
      app = appInstance

      const created = await result.getOrCreateCohort('Trio A')

      expect(created).toEqual(fakeCohort)
      expect(result.cohortGroupsCache.value).toContainEqual(fakeCohort)
    })

    it('rejects and does not store the SerializableError when createCohort fails (duplicate name)', async () => {
      window.api.caseMetadata.createCohort = vi.fn().mockResolvedValue(fakeSerializableError)

      const [result, appInstance] = withSetup(() => useCaseMetadata())
      app = appInstance

      await expect(result.getOrCreateCohort('dup')).rejects.toMatchObject({ code: 'DB_ERROR' })
      expect(result.cohortGroupsCache.value.length).toBe(0)
    })
  })

  describe('assignHpoTerm', () => {
    const caseId = 1

    it('optimistically adds then replaces with the server-confirmed term on success', async () => {
      const serverTerm: CaseHpoTerm = {
        id: 99,
        case_id: caseId,
        hpo_id: 'HP:0001250',
        hpo_label: 'Seizure',
        created_at: 1_700_000_000_000
      }
      window.api.caseMetadata.assignHpoTerm = vi.fn().mockResolvedValue(serverTerm)

      const [result, appInstance] = withSetup(() => useCaseMetadata())
      app = appInstance
      result.metadataCache.value.set(caseId, makeFullMetadata())

      await result.assignHpoTerm(caseId, 'HP:0001250', 'Seizure')

      const cached = result.metadataCache.value.get(caseId)
      expect(cached?.hpoTerms).toEqual([serverTerm])
    })

    it('reverts the optimistic push when assignHpoTerm fails (duplicate HPO term)', async () => {
      window.api.caseMetadata.assignHpoTerm = vi.fn().mockResolvedValue(fakeSerializableError)

      const [result, appInstance] = withSetup(() => useCaseMetadata())
      app = appInstance
      result.metadataCache.value.set(caseId, makeFullMetadata())

      const baselineLength = result.metadataCache.value.get(caseId)?.hpoTerms.length ?? 0

      await expect(result.assignHpoTerm(caseId, 'HP:0001250', 'Seizure')).rejects.toMatchObject({
        code: 'DB_ERROR'
      })

      const cached = result.metadataCache.value.get(caseId)
      // Reverted back to baseline — no error-shaped object and no orphaned
      // optimistic entry left behind.
      expect(cached?.hpoTerms.length).toBe(baselineLength)
      expect(cached?.hpoTerms.some((t) => t.hpo_id === 'HP:0001250')).toBe(false)
      expect(logService.error).toHaveBeenCalledWith(
        expect.stringContaining('A cohort with this name already exists'),
        'case-metadata'
      )
    })
  })

  describe('setCaseCohorts', () => {
    const caseId = 1

    it('optimistically replaces cohorts and keeps them on success', async () => {
      window.api.caseMetadata.setCohorts = vi.fn().mockResolvedValue(undefined)

      const [result, appInstance] = withSetup(() => useCaseMetadata())
      app = appInstance
      result.cohortGroupsCache.value.push(fakeCohort)
      result.metadataCache.value.set(caseId, makeFullMetadata())

      await result.setCaseCohorts(caseId, [fakeCohort.id])

      const cached = result.metadataCache.value.get(caseId)
      expect(cached?.cohorts).toEqual([fakeCohort])
      expect(window.api.caseMetadata.setCohorts).toHaveBeenCalledWith(caseId, [fakeCohort.id])
    })

    it('reverts the optimistic cohort replacement when setCohorts fails', async () => {
      window.api.caseMetadata.setCohorts = vi.fn().mockResolvedValue(fakeSerializableError)
      window.api.caseMetadata.getFullMetadata = vi.fn().mockResolvedValue(makeFullMetadata())

      const [result, appInstance] = withSetup(() => useCaseMetadata())
      app = appInstance
      result.cohortGroupsCache.value.push(fakeCohort)
      const seeded = makeFullMetadata({ cohorts: [] })
      result.metadataCache.value.set(caseId, seeded)

      await expect(result.setCaseCohorts(caseId, [fakeCohort.id])).rejects.toMatchObject({
        code: 'DB_ERROR'
      })
      await flushPromises()

      // Reverted to the pre-optimistic value (empty), never left holding the
      // optimistically-applied cohort that the backend actually rejected.
      const cached = result.metadataCache.value.get(caseId)
      expect(cached?.cohorts).toEqual([])
      expect(logService.error).toHaveBeenCalledWith(
        expect.stringContaining('A cohort with this name already exists'),
        'case-metadata'
      )
    })
  })

  describe('removeHpoTerm', () => {
    const caseId = 1
    const existingTerm: CaseHpoTerm = {
      id: 5,
      case_id: caseId,
      hpo_id: 'HP:0001250',
      hpo_label: 'Seizure',
      created_at: 1_700_000_000_000
    }

    it('optimistically removes the term and keeps it removed on success', async () => {
      window.api.caseMetadata.removeHpoTerm = vi.fn().mockResolvedValue(undefined)

      const [result, appInstance] = withSetup(() => useCaseMetadata())
      app = appInstance
      result.metadataCache.value.set(caseId, makeFullMetadata({ hpoTerms: [existingTerm] }))

      await result.removeHpoTerm(caseId, existingTerm.hpo_id)

      const cached = result.metadataCache.value.get(caseId)
      expect(cached?.hpoTerms).toEqual([])
    })

    it('reverts the optimistic removal when removeHpoTerm fails', async () => {
      window.api.caseMetadata.removeHpoTerm = vi.fn().mockResolvedValue(fakeSerializableError)

      const [result, appInstance] = withSetup(() => useCaseMetadata())
      app = appInstance
      result.metadataCache.value.set(caseId, makeFullMetadata({ hpoTerms: [existingTerm] }))

      await expect(result.removeHpoTerm(caseId, existingTerm.hpo_id)).rejects.toMatchObject({
        code: 'DB_ERROR'
      })

      // Reverted back to the pre-optimistic term list — the SerializableError
      // must never have been treated as a success that lets the removal stand.
      const cached = result.metadataCache.value.get(caseId)
      expect(cached?.hpoTerms).toEqual([existingTerm])
      expect(logService.error).toHaveBeenCalledWith(
        expect.stringContaining('A cohort with this name already exists'),
        'case-metadata'
      )
    })
  })

  describe('metadata upsert paths (affected-status/sex/age/dob)', () => {
    const caseId = 1

    it.each([
      {
        label: 'updateStatus',
        field: 'affected_status' as const,
        previous: 'unaffected' as const,
        call: (r: ReturnType<typeof useCaseMetadata>) => r.updateStatus(caseId, 'affected')
      },
      {
        label: 'updateSex',
        field: 'sex' as const,
        previous: 'unknown' as const,
        call: (r: ReturnType<typeof useCaseMetadata>) => r.updateSex(caseId, 'male')
      },
      {
        label: 'updateAge',
        field: 'age' as const,
        previous: 10,
        call: (r: ReturnType<typeof useCaseMetadata>) => r.updateAge(caseId, 42)
      },
      {
        label: 'updateDob',
        field: 'date_of_birth' as const,
        previous: '1990-01-01',
        call: (r: ReturnType<typeof useCaseMetadata>) => r.updateDob(caseId, '2000-01-01')
      }
    ])(
      '$label reverts the optimistic update when upsert fails',
      async ({ call, field, previous }) => {
        window.api.caseMetadata.upsert = vi.fn().mockResolvedValue(fakeSerializableError)

        const [result, appInstance] = withSetup(() => useCaseMetadata())
        app = appInstance
        const seeded = makeFullMetadata()
        seeded.metadata = { ...seeded.metadata!, [field]: previous }
        result.metadataCache.value.set(caseId, seeded)

        await expect(call(result)).rejects.toMatchObject({ code: 'DB_ERROR' })
        await flushPromises()

        const cached = result.metadataCache.value.get(caseId)
        // Must be reverted to the pre-optimistic value, never the raw
        // SerializableError object.
        expect(cached?.metadata?.[field]).toBe(previous)
        expect(logService.error).toHaveBeenCalledWith(
          expect.stringContaining('A cohort with this name already exists'),
          'case-metadata'
        )
      }
    )

    it('updateStatus stores the server-confirmed metadata on success', async () => {
      const updated = {
        id: 1,
        case_id: caseId,
        affected_status: 'affected' as const,
        sex: null,
        notes: null,
        age: null,
        date_of_birth: null,
        created_at: 1_700_000_000_000,
        updated_at: 1_700_000_000_001
      }
      window.api.caseMetadata.upsert = vi.fn().mockResolvedValue(updated)

      const [result, appInstance] = withSetup(() => useCaseMetadata())
      app = appInstance
      result.metadataCache.value.set(caseId, makeFullMetadata())

      await result.updateStatus(caseId, 'affected')

      const cached = result.metadataCache.value.get(caseId)
      expect(cached?.metadata).toEqual(updated)
    })
  })

  describe('overlapping case mutations', () => {
    const caseId = 1

    it('continues with a newer status update after the earlier update fails', async () => {
      const firstResult = deferred<unknown>()
      const secondResult = deferred<unknown>()
      window.api.caseMetadata.upsert = vi
        .fn()
        .mockReturnValueOnce(firstResult.promise)
        .mockReturnValueOnce(secondResult.promise)

      const [result, appInstance] = withSetup(() => useCaseMetadata())
      app = appInstance
      const seeded = makeFullMetadata()
      seeded.metadata = { ...seeded.metadata!, affected_status: 'unaffected' }
      result.metadataCache.value.set(caseId, seeded)

      const firstUpdate = result.updateStatus(caseId, 'affected')
      await flushPromises()
      const secondUpdate = result.updateStatus(caseId, 'unknown')
      await flushPromises()

      expect(window.api.caseMetadata.upsert).toHaveBeenCalledTimes(1)
      expect(result.metadataCache.value.get(caseId)?.metadata?.affected_status).toBe('affected')

      const firstFailure = expect(firstUpdate).rejects.toMatchObject({ code: 'DB_ERROR' })
      firstResult.resolve(fakeSerializableError)
      await firstFailure
      await flushPromises()

      expect(window.api.caseMetadata.upsert).toHaveBeenCalledTimes(2)
      expect(result.metadataCache.value.get(caseId)?.metadata?.affected_status).toBe('unknown')

      secondResult.resolve({ ...seeded.metadata!, affected_status: 'unknown' })
      await secondUpdate
      expect(result.metadataCache.value.get(caseId)?.metadata?.affected_status).toBe('unknown')
    })

    it('keeps the confirmed age when the queued newer age update fails', async () => {
      const firstResult = deferred<unknown>()
      const secondResult = deferred<unknown>()
      window.api.caseMetadata.upsert = vi
        .fn()
        .mockReturnValueOnce(firstResult.promise)
        .mockReturnValueOnce(secondResult.promise)

      const [result, appInstance] = withSetup(() => useCaseMetadata())
      app = appInstance
      const seeded = makeFullMetadata()
      seeded.metadata = { ...seeded.metadata!, age: 10 }
      result.metadataCache.value.set(caseId, seeded)

      const firstUpdate = result.updateAge(caseId, 20)
      await flushPromises()
      const secondUpdate = result.updateAge(caseId, 30)
      await flushPromises()

      expect(window.api.caseMetadata.upsert).toHaveBeenCalledTimes(1)
      expect(result.metadataCache.value.get(caseId)?.metadata?.age).toBe(20)

      firstResult.resolve({ ...seeded.metadata!, age: 20 })
      await firstUpdate
      await flushPromises()

      expect(window.api.caseMetadata.upsert).toHaveBeenCalledTimes(2)
      expect(result.metadataCache.value.get(caseId)?.metadata?.age).toBe(30)

      const secondFailure = expect(secondUpdate).rejects.toMatchObject({ code: 'DB_ERROR' })
      secondResult.resolve(fakeSerializableError)
      await secondFailure
      expect(result.metadataCache.value.get(caseId)?.metadata?.age).toBe(20)
    })

    it('rolls a failed queued cohort replacement back to the confirmed cohorts', async () => {
      const secondCohort: CohortGroup = { ...fakeCohort, id: 43, name: 'Trio B' }
      const firstResult = deferred<unknown>()
      const secondResult = deferred<unknown>()
      window.api.caseMetadata.setCohorts = vi
        .fn()
        .mockReturnValueOnce(firstResult.promise)
        .mockReturnValueOnce(secondResult.promise)
      window.api.caseMetadata.getFullMetadata = vi
        .fn()
        .mockResolvedValue(makeFullMetadata({ cohorts: [fakeCohort] }))

      const [result, appInstance] = withSetup(() => useCaseMetadata())
      app = appInstance
      result.cohortGroupsCache.value.push(fakeCohort, secondCohort)
      result.metadataCache.value.set(caseId, makeFullMetadata())

      const firstUpdate = result.setCaseCohorts(caseId, [fakeCohort.id])
      await flushPromises()
      const secondUpdate = result.setCaseCohorts(caseId, [secondCohort.id])
      await flushPromises()

      expect(window.api.caseMetadata.setCohorts).toHaveBeenCalledTimes(1)
      expect(result.metadataCache.value.get(caseId)?.cohorts).toEqual([fakeCohort])

      firstResult.resolve(undefined)
      await firstUpdate
      await flushPromises()

      expect(window.api.caseMetadata.setCohorts).toHaveBeenCalledTimes(2)
      expect(result.metadataCache.value.get(caseId)?.cohorts).toEqual([secondCohort])

      const secondFailure = expect(secondUpdate).rejects.toMatchObject({ code: 'DB_ERROR' })
      secondResult.resolve(fakeSerializableError)
      await secondFailure
      expect(result.metadataCache.value.get(caseId)?.cohorts).toEqual([fakeCohort])
    })

    it('runs a queued HPO assignment after an earlier assignment fails', async () => {
      const firstResult = deferred<unknown>()
      const secondResult = deferred<unknown>()
      const secondTerm: CaseHpoTerm = {
        id: 12,
        case_id: caseId,
        hpo_id: 'HP:0004322',
        hpo_label: 'Short stature',
        created_at: 1_700_000_000_001
      }
      window.api.caseMetadata.assignHpoTerm = vi
        .fn()
        .mockReturnValueOnce(firstResult.promise)
        .mockReturnValueOnce(secondResult.promise)

      const [result, appInstance] = withSetup(() => useCaseMetadata())
      app = appInstance
      result.metadataCache.value.set(caseId, makeFullMetadata())

      const firstUpdate = result.assignHpoTerm(caseId, 'HP:0001250', 'Seizure')
      await flushPromises()
      const secondUpdate = result.assignHpoTerm(caseId, secondTerm.hpo_id, secondTerm.hpo_label)
      await flushPromises()

      expect(window.api.caseMetadata.assignHpoTerm).toHaveBeenCalledTimes(1)
      expect(result.metadataCache.value.get(caseId)?.hpoTerms.map((term) => term.hpo_id)).toEqual([
        'HP:0001250'
      ])

      const firstFailure = expect(firstUpdate).rejects.toMatchObject({ code: 'DB_ERROR' })
      firstResult.resolve(fakeSerializableError)
      await firstFailure
      await flushPromises()

      expect(window.api.caseMetadata.assignHpoTerm).toHaveBeenCalledTimes(2)
      expect(result.metadataCache.value.get(caseId)?.hpoTerms.map((term) => term.hpo_id)).toEqual([
        secondTerm.hpo_id
      ])

      secondResult.resolve(secondTerm)
      await secondUpdate
      expect(result.metadataCache.value.get(caseId)?.hpoTerms).toEqual([secondTerm])
    })
  })

  describe('database-generation isolation', () => {
    const caseId = 1

    it('does not let an old metadata load overwrite the new database cache', async () => {
      const oldLoad = deferred<unknown>()
      const newMetadata = makeFullMetadata()
      newMetadata.metadata = { ...newMetadata.metadata!, age: 99 }
      window.api.caseMetadata.getFullMetadata = vi
        .fn()
        .mockReturnValueOnce(oldLoad.promise)
        .mockResolvedValueOnce(newMetadata)

      const [result, appInstance] = withSetup(() => useCaseMetadata())
      app = appInstance

      const oldRequest = result.loadMetadata(caseId)
      await flushPromises()
      result.clearCache()
      const newRequest = result.loadMetadata(caseId)
      await newRequest

      oldLoad.resolve(makeFullMetadata())
      await oldRequest

      expect(result.metadataCache.value.get(caseId)?.metadata?.age).toBe(99)
    })

    it('does not let an old cohort load overwrite the new database cache', async () => {
      const oldLoad = deferred<unknown>()
      const newCohort: CohortGroup = { ...fakeCohort, id: 77, name: 'New database cohort' }
      window.api.caseMetadata.listCohorts = vi
        .fn()
        .mockReturnValueOnce(oldLoad.promise)
        .mockResolvedValueOnce([newCohort])

      const [result, appInstance] = withSetup(() => useCaseMetadata())
      app = appInstance

      const oldRequest = result.loadCohortGroups()
      await flushPromises()
      result.clearCache()
      await result.loadCohortGroups()

      oldLoad.resolve([fakeCohort])
      await oldRequest

      expect(result.cohortGroupsCache.value).toEqual([newCohort])
    })

    it('drops queued old-database mutations before they can call IPC or overwrite a colliding case', async () => {
      const oldWrite = deferred<unknown>()
      const oldConfirmed = makeFullMetadata()
      oldConfirmed.metadata = { ...oldConfirmed.metadata!, age: 20 }
      window.api.caseMetadata.upsert = vi
        .fn()
        .mockReturnValueOnce(oldWrite.promise)
        .mockResolvedValue({ ...oldConfirmed.metadata!, age: 30 })

      const [result, appInstance] = withSetup(() => useCaseMetadata())
      app = appInstance
      result.metadataCache.value.set(caseId, makeFullMetadata())

      const inFlight = result.updateAge(caseId, 20)
      await flushPromises()
      const queued = result.updateAge(caseId, 30)
      await flushPromises()
      expect(window.api.caseMetadata.upsert).toHaveBeenCalledOnce()

      result.clearCache()
      const newDatabaseMetadata = makeFullMetadata()
      newDatabaseMetadata.metadata = { ...newDatabaseMetadata.metadata!, age: 99 }
      result.metadataCache.value.set(caseId, newDatabaseMetadata)

      oldWrite.resolve(oldConfirmed.metadata!)
      await Promise.all([inFlight, queued])
      await flushPromises()

      expect(window.api.caseMetadata.upsert).toHaveBeenCalledOnce()
      expect(result.metadataCache.value.get(caseId)?.metadata?.age).toBe(99)
    })

    it('does not continue a multi-step old-database mutation after its first IPC settles', async () => {
      const created = deferred<unknown>()
      window.api.caseMetadata.createCohort = vi.fn().mockReturnValue(created.promise)

      const [result, appInstance] = withSetup(() => useCaseMetadata())
      app = appInstance

      const mutation = result.createAndAssignCohort(caseId, 'Old database cohort')
      await flushPromises()
      expect(window.api.caseMetadata.createCohort).toHaveBeenCalledOnce()

      result.clearCache()
      created.resolve(fakeCohort)

      await expect(mutation).resolves.toBeNull()
      expect(window.api.caseMetadata.assignCohort).not.toHaveBeenCalled()
      expect(result.cohortGroupsCache.value).toEqual([])
    })
  })
})
