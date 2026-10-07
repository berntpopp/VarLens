/**
 * The migrated data must live in the query cache only. A module-level cache,
 * epoch counter or in-flight map in one of these files would bring back the
 * stale-cache bugs the query cache removes (issue #193): data surviving a
 * database switch, and late responses written after an invalidation.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const RENDERER = resolve(__dirname, '../../../src/renderer/src')

const MIGRATED = [
  'composables/useFilterOptionsCache.ts',
  'composables/useTags.ts',
  'composables/useVariantTags.ts',
  'queries/column-meta.ts',
  'queries/filter-options.ts',
  'queries/filter-presets.ts',
  'queries/tags.ts',
  'queries/cases.ts',
  'components/filters/ExtensionColumnFilters.vue',
  'components/filters/ExtensionColumnControl.vue'
]

/** Module-level state (column 0): a ref, a collection, or anything reassigned. */
const MODULE_STATE =
  /^(?:const|let)\s[^\n]*=\s*(?:ref|shallowRef|reactive)\b|^(?:const|let)\s[^\n]*new (?:Map|Set|LruMap)|^let\s/m

describe('migrated modules hold no cache of their own', () => {
  it('recognises the caches these modules used to have', () => {
    expect('const tagsCache = ref<Tag[]>([])').toMatch(MODULE_STATE)
    expect('const inflight = new Map<string, Promise<unknown>>()').toMatch(MODULE_STATE)
    expect('let cacheEpoch = 0').toMatch(MODULE_STATE)
    expect('const NO_FILTER_OPTIONS: FilterOptions = {').not.toMatch(MODULE_STATE)
  })

  it.each(MIGRATED)('%s', (file) => {
    const source = readFileSync(resolve(RENDERER, file), 'utf8')
    // In a .vue file column 0 is component setup, which is per instance.
    if (file.endsWith('.ts')) expect(source).not.toMatch(MODULE_STATE)
    expect(source).not.toMatch(/cacheEpoch|inflight|inFlight|LruMap/)
  })

  it('keeps only the active-preset UI state at module level in the preset store', () => {
    const source = readFileSync(resolve(RENDERER, 'composables/useFilterPresetStore.ts'), 'utf8')
    const moduleState = source.match(/^(?:const|let) \w+/gm) ?? []
    expect(moduleState).toEqual(['const activeByScope'])
  })
})
