/**
 * Tag caches across a database switch.
 *
 * The tag list and the per-variant tag cache are module-level and keyed by
 * ids that restart in every database, so `resetTagCaches()` must empty them
 * and must stop a load that was started against the previous database from
 * writing its result afterwards.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Tag } from '../../../src/shared/types/database-entities'
import { createMockApi } from '../../utils/mock-api'
import { useTags, resetTagCaches } from '../../../src/renderer/src/composables/useTags'

vi.mock('../../../src/renderer/src/services/LogService', () => ({
  logService: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

const oldTag = { id: 1, name: 'Old database tag', color: '#F44336' } as Tag
const newTag = { id: 1, name: 'New database tag', color: '#2196F3' } as Tag

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('resetTagCaches', () => {
  beforeEach(() => {
    resetTagCaches()
    window.api = createMockApi()
  })

  it('empties the tag list and the per-variant tags', async () => {
    window.api.tags.list = vi.fn().mockResolvedValue([oldTag])
    window.api.tags.getVariantTags = vi.fn().mockResolvedValue([oldTag])
    const tags = useTags()
    await tags.loadTags()
    await tags.loadVariantTags(1, 10)
    expect(tags.getTags()).toEqual([oldTag])
    expect(tags.getVariantTags(1, 10)).toEqual([oldTag])

    resetTagCaches()

    expect(tags.getTags()).toEqual([])
    expect(tags.getVariantTags(1, 10)).toEqual([])
  })

  it('ignores a tag list that settles after the reset and lets the next load run', async () => {
    const slow = deferred<Tag[]>()
    const list = vi.fn().mockReturnValueOnce(slow.promise).mockResolvedValueOnce([newTag])
    window.api.tags.list = list
    const tags = useTags()

    const stale = tags.loadTags()
    resetTagCaches()
    // The previous load is still in flight; the new database's load must not
    // be skipped because of it.
    await tags.loadTags()
    expect(tags.getTags()).toEqual([newTag])

    slow.resolve([oldTag])
    await stale

    expect(list).toHaveBeenCalledTimes(2)
    expect(tags.getTags()).toEqual([newTag])
    expect(tags.isLoadingTags.value).toBe(false)
  })

  it('ignores variant tags that settle after the reset', async () => {
    const slow = deferred<Tag[]>()
    window.api.tags.getVariantTags = vi.fn().mockReturnValueOnce(slow.promise)
    const tags = useTags()

    const stale = tags.loadVariantTags(1, 10)
    resetTagCaches()
    slow.resolve([oldTag])
    await stale

    expect(tags.getVariantTags(1, 10)).toEqual([])
    expect(tags.isVariantTagsLoading(1, 10)).toBe(false)
  })
})
