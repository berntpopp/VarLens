/**
 * useTags (the tag list) and useVariantTags (the tags of one variant), both
 * read from the query cache.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import type { Pinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { useTags } from '../../../src/renderer/src/composables/useTags'
import { useVariantTags } from '../../../src/renderer/src/composables/useVariantTags'
import { invalidateServerData } from '../../../src/renderer/src/queries/invalidation'
import { useDatabaseStore } from '../../../src/renderer/src/stores/databaseStore'
import type { Tag } from '../../../src/shared/types/database-entities'
import { createQueryPinia, withQueries } from '../helpers/with-queries'

vi.mock('../../../src/renderer/src/services/LogService', () => ({
  logService: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

const tag = (id: number, name: string): Tag => ({ id, name, color: '#F44336' }) as Tag
const REVIEW = tag(1, 'Review')
const URGENT = tag(2, 'Urgent')

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  let reject: (reason: unknown) => void = () => {}
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('tags', () => {
  const api = {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getUsageCount: vi.fn(),
    getVariantTags: vi.fn(),
    assignVariantTag: vi.fn(),
    removeVariantTag: vi.fn()
  }
  const hosts: Array<{ unmount: () => void }> = []
  let pinia: Pinia

  function mount<T>(composable: () => T): T {
    const host = withQueries(composable, pinia)
    hosts.push(host)
    return host.result
  }
  const mountVariant = (caseId = ref(1), variantId = ref(10)) =>
    mount(() => useVariantTags(caseId, variantId))

  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset())
    api.list.mockResolvedValue([REVIEW, URGENT])
    api.getVariantTags.mockResolvedValue([REVIEW])
    api.assignVariantTag.mockResolvedValue(undefined)
    api.removeVariantTag.mockResolvedValue(undefined)
    Object.assign(window, { api: { tags: api } })
    pinia = createQueryPinia()
  })

  afterEach(() => hosts.splice(0).forEach((host) => host.unmount()))

  describe('tag list', () => {
    it('loads once for any number of consumers', async () => {
      const first = mount(useTags)
      const second = mount(useTags)
      await Promise.all([first.loadTags(), second.loadTags()])

      expect(api.list).toHaveBeenCalledTimes(1)
      expect(second.getTags()).toEqual([REVIEW, URGENT])
    })

    it('swallows a failed load and loads again on the next call', async () => {
      api.list.mockRejectedValueOnce(new Error('offline'))
      const tags = mount(useTags)

      await expect(tags.loadTags()).resolves.toBeUndefined()
      expect(tags.getTags()).toEqual([])

      await tags.loadTags()
      expect(tags.getTags()).toEqual([REVIEW, URGENT])
    })

    it('refetches when another view showing tags mounts', async () => {
      mount(useTags)
      await flushPromises()
      mount(useTags)
      await flushPromises()

      expect(api.list).toHaveBeenCalledTimes(2)
    })

    it('does not fail a write that succeeded when the refetch after it fails', async () => {
      api.create.mockResolvedValue(tag(3, 'Benign'))
      const tags = mount(useTags)
      await tags.loadTags()
      api.list.mockRejectedValue(new Error('offline'))

      await expect(tags.createTag('Benign', '#4CAF50')).resolves.toEqual(tag(3, 'Benign'))
    })

    it('shows a created tag once the write has returned', async () => {
      const created = tag(3, 'Benign')
      api.create.mockResolvedValue(created)
      const tags = mount(useTags)
      await tags.loadTags()
      api.list.mockResolvedValue([created, REVIEW, URGENT])

      await expect(tags.createTag('Benign', '#4CAF50')).resolves.toEqual(created)
      expect(tags.getTags()).toEqual([created, REVIEW, URGENT])
    })

    it('refreshes the tags shown on a variant when a tag is renamed or deleted', async () => {
      const tags = mount(useTags)
      const variant = mountVariant()
      await flushPromises()
      const renamed = tag(1, 'Reviewed')
      api.update.mockResolvedValue(renamed)
      api.list.mockResolvedValue([renamed, URGENT])
      api.getVariantTags.mockResolvedValue([renamed])

      await tags.updateTag(1, { name: 'Reviewed' })
      expect(variant.variantTags.value).toEqual([renamed])

      api.delete.mockResolvedValue(undefined)
      api.getVariantTags.mockResolvedValue([])
      await tags.deleteTag(1)
      expect(variant.variantTags.value).toEqual([])
    })

    it("shows the new database's tags after a switch, never the old ones", async () => {
      const tags = mount(useTags)
      await tags.loadTags()
      api.list.mockResolvedValue([URGENT])

      useDatabaseStore().revision++
      await invalidateServerData('database-switch')
      expect(tags.getTags()).toEqual([])

      await flushPromises()
      expect(tags.getTags()).toEqual([URGENT])
    })

    it('ignores a tag list that arrives from the previous database', async () => {
      const slow = deferred<Tag[]>()
      api.list.mockReturnValueOnce(slow.promise)
      const tags = mount(useTags)
      await flushPromises()
      api.list.mockResolvedValue([URGENT])

      useDatabaseStore().revision++
      await invalidateServerData('database-switch')
      await flushPromises()
      slow.resolve([REVIEW])
      await flushPromises()

      expect(tags.getTags()).toEqual([URGENT])
    })
  })

  describe('tags of a variant', () => {
    it('loads the tags of the variant it is given and follows it', async () => {
      const variantId = ref(10)
      const variant = mountVariant(ref(1), variantId)
      await flushPromises()
      expect(api.getVariantTags).toHaveBeenCalledWith(1, 10)
      expect(variant.variantTags.value).toEqual([REVIEW])

      api.getVariantTags.mockResolvedValue([URGENT])
      variantId.value = 11
      expect(variant.variantTags.value).toEqual([])
      await flushPromises()
      expect(variant.variantTags.value).toEqual([URGENT])
    })

    it('never shows the previous variant when its response arrives last', async () => {
      const slow = deferred<Tag[]>()
      api.getVariantTags.mockReturnValueOnce(slow.promise)
      const variantId = ref(10)
      const variant = mountVariant(ref(1), variantId)
      await flushPromises()

      api.getVariantTags.mockResolvedValue([URGENT])
      variantId.value = 11
      await flushPromises()
      slow.resolve([REVIEW])
      await flushPromises()

      expect(variant.variantTags.value).toEqual([URGENT])
    })

    it("does not show another database's tags for the same case and variant ids", async () => {
      const variant = mountVariant()
      await flushPromises()
      api.getVariantTags.mockResolvedValue([URGENT])

      useDatabaseStore().revision++
      await invalidateServerData('database-switch')
      expect(variant.variantTags.value).toEqual([])

      await flushPromises()
      expect(variant.variantTags.value).toEqual([URGENT])
    })

    it('shows an assigned tag at once, sorted by name', async () => {
      const write = deferred<void>()
      api.assignVariantTag.mockReturnValue(write.promise)
      api.getVariantTags.mockResolvedValue([URGENT])
      const variant = mountVariant()
      await flushPromises()

      const pending = variant.assignTag(REVIEW)
      expect(variant.variantTags.value).toEqual([REVIEW, URGENT])
      expect(api.assignVariantTag).toHaveBeenCalledWith(1, 10, 1)

      api.getVariantTags.mockResolvedValue([REVIEW, URGENT])
      write.resolve()
      await pending
      await flushPromises()
      expect(variant.variantTags.value).toEqual([REVIEW, URGENT])
    })

    it('puts the tags back and rejects when a write fails', async () => {
      api.removeVariantTag.mockRejectedValue(new Error('read-only'))
      const variant = mountVariant()
      await flushPromises()

      await expect(variant.removeTag(1)).rejects.toThrow('read-only')
      expect(variant.variantTags.value).toEqual([REVIEW])
      await flushPromises()
      expect(variant.variantTags.value).toEqual([REVIEW])
    })

    it('keeps the optimistic tags when a read that started earlier lands afterwards', async () => {
      const slowRead = deferred<Tag[]>()
      const write = deferred<void>()
      api.getVariantTags.mockReturnValueOnce(slowRead.promise)
      api.assignVariantTag.mockReturnValue(write.promise)
      const variant = mountVariant()
      await flushPromises()

      const pending = variant.assignTag(URGENT)
      slowRead.resolve([REVIEW])
      await flushPromises()
      expect(variant.variantTags.value).toEqual([URGENT])

      write.resolve()
      await pending
    })

    it("shows the server's tags after a write made before the first read finished", async () => {
      // The optimistic value is built from what is known; the tags the variant
      // already had only arrive with the refetch that follows the write.
      api.getVariantTags.mockReturnValueOnce(new Promise<Tag[]>(() => {}))
      const variant = mountVariant()
      await flushPromises()
      api.getVariantTags.mockResolvedValue([REVIEW, URGENT])

      await variant.assignTag(URGENT)
      await flushPromises()

      expect(variant.variantTags.value).toEqual([REVIEW, URGENT])
    })

    it("refetches the variant's tags when the view moves back to it", async () => {
      const variantId = ref(10)
      mountVariant(ref(1), variantId)
      await flushPromises()
      variantId.value = 11
      await flushPromises()
      variantId.value = 10
      await flushPromises()

      expect(api.getVariantTags.mock.calls.map(([, id]) => id)).toEqual([10, 11, 10])
    })

    it('leaves a database opened meanwhile untouched when a write fails late', async () => {
      const write = deferred<void>()
      api.removeVariantTag.mockReturnValue(write.promise)
      const variant = mountVariant()
      await flushPromises()
      const pending = variant.removeTag(1)

      api.getVariantTags.mockResolvedValue([URGENT])
      useDatabaseStore().revision++
      await invalidateServerData('database-switch')
      await flushPromises()
      write.reject(new Error('gone'))

      await expect(pending).rejects.toThrow('gone')
      expect(variant.variantTags.value).toEqual([URGENT])
    })

    it('leaves a database opened meanwhile untouched when a write succeeds late', async () => {
      const write = deferred<void>()
      api.assignVariantTag.mockReturnValue(write.promise)
      const variant = mountVariant()
      await flushPromises()
      const pending = variant.assignTag(URGENT)

      api.getVariantTags.mockResolvedValue([])
      useDatabaseStore().revision++
      await invalidateServerData('database-switch')
      await flushPromises()
      write.resolve()
      await pending

      expect(variant.variantTags.value).toEqual([])
    })
  })
})
