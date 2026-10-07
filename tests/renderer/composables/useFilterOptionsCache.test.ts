/**
 * useFilterOptionsCache: the current case's filter options, read from the
 * query cache.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import type { Pinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { useFilterOptionsCache } from '@renderer/composables/useFilterOptionsCache'
import type { FilterOptions } from '../../../src/shared/types/api'
import { ErrorCode } from '../../../src/shared/types/errors'
import { invalidateServerData } from '../../../src/renderer/src/queries/invalidation'
import { useCapabilityStore } from '../../../src/renderer/src/stores/capabilityStore'
import { useDatabaseStore } from '../../../src/renderer/src/stores/databaseStore'
import { logService } from '../../../src/renderer/src/services/LogService'
import { createQueryPinia, withQueries } from '../helpers/with-queries'
import { installCapabilities } from '../helpers/capabilities'

vi.mock('../../../src/renderer/src/services/LogService', () => ({
  logService: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

function makeFilterOptions(overrides: Partial<FilterOptions> = {}): FilterOptions {
  return {
    consequences: ['HIGH', 'MODERATE'],
    funcs: ['missense_variant'],
    clinvars: ['Pathogenic'],
    minCadd: 0,
    maxCadd: 40,
    minGnomadAf: 0,
    maxGnomadAf: 0.01,
    columnMeta: [],
    ...overrides
  }
}

/** Options whose `consequences` name the case they were loaded for. */
const optionsOf = (caseId: number): FilterOptions =>
  makeFilterOptions({ consequences: [`case-${caseId}`] })

describe('useFilterOptionsCache', () => {
  const getFilterOptions = vi.fn()
  const hosts: Array<{ unmount: () => void }> = []
  let pinia: Pinia

  function mountCache(caseId = ref(1)) {
    const host = withQueries(() => useFilterOptionsCache(caseId), pinia)
    hosts.push(host)
    return { ...host.result, caseId }
  }

  beforeEach(() => {
    getFilterOptions.mockReset().mockImplementation(async (caseId: number) => optionsOf(caseId))
    Object.assign(window, { api: { variants: { getFilterOptions } } })
    pinia = createQueryPinia()
  })

  afterEach(() => hosts.splice(0).forEach((host) => host.unmount()))

  it('starts with empty filter options', () => {
    const { filterOptions } = mountCache()
    expect(filterOptions.value.consequences).toEqual([])
    expect(filterOptions.value.minCadd).toBeNull()
  })

  it('loads the options of the current case', async () => {
    const { filterOptions, loadFilterOptions } = mountCache(ref(7))
    await loadFilterOptions()

    expect(getFilterOptions).toHaveBeenCalledWith(7)
    expect(filterOptions.value).toEqual(optionsOf(7))
  })

  it('asks once however many consumers and loads there are', async () => {
    const first = mountCache()
    const second = mountCache()
    await Promise.all([first.loadFilterOptions(), second.loadFilterOptions()])
    await first.loadFilterOptions()

    expect(getFilterOptions).toHaveBeenCalledTimes(1)
    expect(second.filterOptions.value).toEqual(optionsOf(1))
  })

  it('follows the case and keeps each case cached', async () => {
    const { filterOptions, caseId } = mountCache()
    await flushPromises()

    caseId.value = 2
    await flushPromises()
    expect(filterOptions.value).toEqual(optionsOf(2))

    caseId.value = 1
    await flushPromises()
    expect(filterOptions.value).toEqual(optionsOf(1))
    expect(getFilterOptions).toHaveBeenCalledTimes(2)
  })

  it('never shows the previous case when its response arrives last', async () => {
    let resolveFirst: (value: FilterOptions) => void = () => {}
    getFilterOptions.mockImplementationOnce(
      () => new Promise<FilterOptions>((resolve) => (resolveFirst = resolve))
    )
    const { filterOptions, caseId } = mountCache()
    await flushPromises()

    caseId.value = 2
    await flushPromises()
    resolveFirst(optionsOf(1))
    await flushPromises()

    expect(filterOptions.value).toEqual(optionsOf(2))
  })

  it("does not show another database's options for the same case id", async () => {
    const { filterOptions } = mountCache()
    await flushPromises()
    getFilterOptions.mockResolvedValue(makeFilterOptions({ consequences: ['other database'] }))

    useDatabaseStore().revision++
    await invalidateServerData('database-switch')
    expect(filterOptions.value.consequences).toEqual([])

    await flushPromises()
    expect(filterOptions.value.consequences).toEqual(['other database'])
  })

  it('refetches after an import or delete', async () => {
    mountCache()
    await flushPromises()

    await invalidateServerData('data-changed')
    expect(getFilterOptions).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['an Error', new Error('IPC failure')],
    [
      'a SerializableError',
      { code: ErrorCode.DB_ERROR, message: 'db', userMessage: 'Database error' }
    ]
  ])('logs %s, keeps the empty options and does not throw', async (_label, failure) => {
    getFilterOptions.mockImplementation(async () => {
      throw failure
    })
    const { filterOptions, loadFilterOptions } = mountCache()

    await expect(loadFilterOptions()).resolves.toBeUndefined()
    expect(filterOptions.value.consequences).toEqual([])
    expect(logService.warn).toHaveBeenCalled()
  })

  it('does not call the API while the capability document is missing', async () => {
    useCapabilityStore(pinia).setDocument(null)
    const { loadFilterOptions } = mountCache()
    await loadFilterOptions()
    await flushPromises()
    expect(getFilterOptions).not.toHaveBeenCalled()

    installCapabilities()
    await flushPromises()
    expect(getFilterOptions).toHaveBeenCalledTimes(1)
  })
})
