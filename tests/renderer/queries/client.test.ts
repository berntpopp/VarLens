import { describe, it, expect, vi, afterEach } from 'vitest'
import { isReactive } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { useQuery, useQueryCache } from '@pinia/colada'

import { isRetryableError } from '../../../src/renderer/src/queries/client'
import { ErrorCode, type SerializableError } from '../../../src/shared/types/errors'
import { createQueryPinia, withQueries } from '../helpers/with-queries'

const ipcError = (code: ErrorCode): SerializableError => ({
  code,
  message: code,
  userMessage: code
})

describe('isRetryableError', () => {
  it.each([
    ErrorCode.VALIDATION,
    ErrorCode.NOT_FOUND,
    ErrorCode.FORBIDDEN,
    ErrorCode.UNSUPPORTED_RUNTIME,
    ErrorCode.CONFLICT
  ])('never retries %s', (code) => {
    expect(isRetryableError(ipcError(code))).toBe(false)
  })

  it('allows a retry for transient failures', () => {
    expect(isRetryableError(ipcError(ErrorCode.UNAVAILABLE_UPSTREAM))).toBe(true)
    expect(isRetryableError(new Error('network'))).toBe(true)
  })
})

describe('query cache defaults', () => {
  const hosts: Array<{ unmount: () => void }> = []
  afterEach(() => hosts.splice(0).forEach((host) => host.unmount()))

  function mountQuery(query: () => Promise<unknown>, pinia = createQueryPinia()) {
    const host = withQueries(() => useQuery({ key: ['t'], query }), pinia)
    hosts.push(host)
    return host
  }

  it('does not refetch fresh data when another consumer mounts', async () => {
    const query = vi.fn().mockResolvedValue('value')
    const first = mountQuery(query)
    await flushPromises()
    const second = mountQuery(query, first.pinia)
    await flushPromises()

    expect(query).toHaveBeenCalledTimes(1)
    expect(second.result.data.value).toBe('value')
  })

  it('refetches on mount when the entry was invalidated while unmounted', async () => {
    const query = vi.fn().mockResolvedValueOnce('old').mockResolvedValueOnce('new')
    const first = mountQuery(query)
    await flushPromises()
    hosts.pop()?.unmount()

    await useQueryCache(first.pinia).invalidateQueries({ key: ['t'] })
    expect(query).toHaveBeenCalledTimes(1)

    const second = mountQuery(query, first.pinia)
    await flushPromises()
    expect(second.result.data.value).toBe('new')
  })

  it('does not retry a failed query on its own', async () => {
    const query = vi.fn().mockRejectedValue(new Error('boom'))
    const host = mountQuery(query)
    await flushPromises()
    await flushPromises()

    expect(query).toHaveBeenCalledTimes(1)
    expect(host.result.status.value).toBe('error')
  })

  it('holds results without deep reactivity', async () => {
    const host = mountQuery(async () => ({ nested: { rows: [{ id: 1 }] } }))
    await flushPromises()

    const data = host.result.data.value as { nested: { rows: unknown[] } }
    expect(isReactive(data)).toBe(false)
    expect(isReactive(data.nested.rows)).toBe(false)
  })
})
