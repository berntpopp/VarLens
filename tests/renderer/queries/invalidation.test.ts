import { describe, it, expect, vi, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { useQuery, useQueryCache } from '@pinia/colada'

import { invalidateServerData } from '../../../src/renderer/src/queries/invalidation'
import { queryKeys } from '../../../src/renderer/src/queries/keys'
import { useDatabaseStore } from '../../../src/renderer/src/stores/databaseStore'
import { createQueryPinia, withQueries } from '../helpers/with-queries'

describe('invalidateServerData', () => {
  const hosts: Array<{ unmount: () => void }> = []
  afterEach(() => hosts.splice(0).forEach((host) => host.unmount()))

  function mountTags(query: () => Promise<unknown>, pinia = createQueryPinia()) {
    const host = withQueries(() => useQuery(() => ({ key: queryKeys.tags(), query })), pinia)
    hosts.push(host)
    return host
  }

  describe('data-changed', () => {
    it('refetches every mounted query exactly once', async () => {
      const query = vi.fn().mockResolvedValueOnce('old').mockResolvedValue('new')
      const first = mountTags(query)
      const second = mountTags(query, first.pinia)
      await flushPromises()

      await invalidateServerData('data-changed')

      expect(query).toHaveBeenCalledTimes(2)
      expect(first.result.data.value).toBe('new')
      expect(second.result.data.value).toBe('new')
    })

    it('leaves an unmounted query stale until it is used again', async () => {
      const query = vi.fn().mockResolvedValueOnce('old').mockResolvedValue('new')
      const first = mountTags(query)
      await flushPromises()
      hosts.pop()?.unmount()

      await invalidateServerData('data-changed')
      expect(query).toHaveBeenCalledTimes(1)

      const second = mountTags(query, first.pinia)
      await flushPromises()
      expect(second.result.data.value).toBe('new')
    })

    it('drops a response that was in flight when the data changed', async () => {
      let resolveFirst: (value: string) => void = () => {}
      const query = vi
        .fn()
        .mockImplementationOnce(() => new Promise<string>((resolve) => (resolveFirst = resolve)))
        .mockResolvedValue('after')
      const host = mountTags(query)
      await flushPromises()

      await invalidateServerData('data-changed')
      resolveFirst('before')
      await flushPromises()

      expect(host.result.data.value).toBe('after')
    })
  })

  describe('data-changed with a cohort mounted', () => {
    it('refetches the cohort scope first, so cohort data is loaded once, for the new cases', async () => {
      const pinia = createQueryPinia()
      const caseIds = vi.fn().mockResolvedValueOnce([1, 2]).mockResolvedValue([1, 2, 3])
      const typesPresent = vi.fn(async (ids: number[]) => ids.join(','))
      const host = withQueries(() => {
        const ids = useQuery(() => ({ key: queryKeys.caseIds(), query: caseIds }))
        const types = useQuery(() => {
          const scope = (ids.data.value as number[] | undefined) ?? []
          return {
            key: queryKeys.typesPresent({ caseIds: scope }),
            query: () => typesPresent(scope),
            enabled: scope.length > 0
          }
        })
        return { types }
      }, pinia)
      hosts.push(host)
      await flushPromises()
      expect(typesPresent.mock.calls).toEqual([[[1, 2]]])

      await invalidateServerData('data-changed')
      await flushPromises()

      expect(typesPresent.mock.calls).toEqual([[[1, 2]], [[1, 2, 3]]])
      expect(host.result.types.data.value).toBe('1,2,3')
    })

    it('still refetches cohort data when the set of cases did not change', async () => {
      const pinia = createQueryPinia()
      const caseIds = vi.fn().mockResolvedValue([1, 2])
      const typesPresent = vi.fn().mockResolvedValue('types')
      const host = withQueries(() => {
        useQuery(() => ({ key: queryKeys.caseIds(), query: caseIds }))
        useQuery(() => ({ key: queryKeys.typesPresent({ caseIds: [1, 2] }), query: typesPresent }))
      }, pinia)
      hosts.push(host)
      await flushPromises()

      await invalidateServerData('data-changed')
      await flushPromises()

      expect(typesPresent).toHaveBeenCalledTimes(2)
    })

    it('resolves even when a refetch fails', async () => {
      const query = vi.fn().mockResolvedValueOnce('old').mockRejectedValue(new Error('offline'))
      mountTags(query)
      await flushPromises()

      await expect(invalidateServerData('data-changed')).resolves.toBeUndefined()
    })
  })

  describe('database-switch', () => {
    it('re-keys mounted queries to the new database and never shows the old data', async () => {
      const query = vi.fn().mockResolvedValueOnce('database A').mockResolvedValue('database B')
      const host = mountTags(query)
      await flushPromises()
      expect(host.result.data.value).toBe('database A')

      useDatabaseStore().revision++
      await invalidateServerData('database-switch')
      expect(host.result.data.value).toBeUndefined()

      await flushPromises()
      expect(host.result.data.value).toBe('database B')
    })

    it('ignores a response from the previous database that arrives after the switch', async () => {
      let resolveOld: (value: string) => void = () => {}
      const query = vi
        .fn()
        .mockImplementationOnce(() => new Promise<string>((resolve) => (resolveOld = resolve)))
        .mockResolvedValue('database B')
      const host = mountTags(query)
      await flushPromises()

      useDatabaseStore().revision++
      await invalidateServerData('database-switch')
      await flushPromises()
      resolveOld('database A')
      await flushPromises()

      expect(host.result.data.value).toBe('database B')
    })

    it('removes entries of the previous database that nothing reads', async () => {
      const host = mountTags(vi.fn().mockResolvedValue('database A'))
      await flushPromises()
      hosts.pop()?.unmount()
      const cache = useQueryCache(host.pinia)
      const oldRoot = queryKeys.root()

      useDatabaseStore().revision++
      await invalidateServerData('database-switch')

      expect(cache.getEntries({ key: oldRoot })).toHaveLength(0)
    })

    it('leaves an entry that a component still reads for the cache to collect', async () => {
      const host = mountTags(vi.fn().mockResolvedValue('database A'))
      await flushPromises()
      const cache = useQueryCache(host.pinia)
      const oldRoot = queryKeys.root()

      // The consumer moves to the new root on its next update, so its old
      // entry is still in use when the switch is announced. It is released,
      // not removed, and the cache collects it after `gcTime`.
      useDatabaseStore().revision++
      await invalidateServerData('database-switch')
      await flushPromises()

      const [released] = cache.getEntries({ key: oldRoot })
      expect(released?.active).toBe(false)
      expect(released?.gcTimeout).toBeDefined()
    })

    it('is safe to call twice for one switch and fetches once', async () => {
      const query = vi.fn().mockResolvedValue('value')
      mountTags(query)
      await flushPromises()

      useDatabaseStore().revision++
      await invalidateServerData('database-switch')
      await flushPromises()
      await invalidateServerData('database-switch')
      await flushPromises()

      expect(query).toHaveBeenCalledTimes(2)
    })

    it('keeps the entries of the current database', async () => {
      const query = vi.fn().mockResolvedValue('value')
      const host = mountTags(query)
      await flushPromises()

      await invalidateServerData('database-switch')
      await flushPromises()

      expect(query).toHaveBeenCalledTimes(1)
      expect(host.result.data.value).toBe('value')
    })
  })
})
