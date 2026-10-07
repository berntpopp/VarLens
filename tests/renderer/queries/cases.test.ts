import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { useQuery } from '@pinia/colada'

import { caseIdsQuery } from '../../../src/renderer/src/queries/cases'
import { invalidateServerData } from '../../../src/renderer/src/queries/invalidation'
import { withQueries } from '../helpers/with-queries'

describe('caseIdsQuery (the cohort scope)', () => {
  const list = vi.fn()

  beforeEach(() => {
    list.mockReset().mockResolvedValue([{ id: 1 }, { id: 2 }])
    Object.assign(window, { api: { cases: { list } } })
  })

  it('picks up a newly imported case, so cohort metadata is asked for the new scope', async () => {
    const host = withQueries(() => useQuery(caseIdsQuery))
    await flushPromises()
    expect(host.result.data.value).toEqual([1, 2])

    list.mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }])
    await invalidateServerData('data-changed')

    expect(host.result.data.value).toEqual([1, 2, 3])
    host.unmount()
  })
})
