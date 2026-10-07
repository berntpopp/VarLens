/**
 * useTranscripts: one variant's transcripts, read from the query cache, and
 * switching the selected transcript.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, type Ref } from 'vue'
import type { Pinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { useTranscripts } from '@renderer/composables/useTranscripts'
import type {
  TranscriptAnnotation,
  TranscriptInsertRow
} from '../../../src/shared/types/transcript'
import { ErrorCode } from '../../../src/shared/types/errors'
import { invalidateServerData } from '../../../src/renderer/src/queries/invalidation'
import { useDatabaseStore } from '../../../src/renderer/src/stores/databaseStore'
import { createQueryPinia, withQueries } from '../helpers/with-queries'

vi.mock('../../../src/renderer/src/services/LogService', () => ({
  logService: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

const transcript = (variantId: number, id = `ENST${variantId}`): TranscriptAnnotation =>
  ({
    id: variantId,
    variant_id: variantId,
    transcript_id: id,
    is_selected: 1
  }) as TranscriptAnnotation

const failure = { code: ErrorCode.DB_ERROR, message: 'boom', userMessage: 'Database busy' }

describe('useTranscripts', () => {
  const list = vi.fn()
  const switchApi = vi.fn()
  const insertAndSwitchApi = vi.fn()
  const hosts: Array<{ unmount: () => void }> = []
  let pinia: Pinia

  function mountTranscripts(variantId: Ref<number | null> = ref(10)) {
    const host = withQueries(() => useTranscripts(variantId), pinia)
    hosts.push(host)
    return { ...host.result, variantId }
  }

  beforeEach(() => {
    list.mockReset().mockImplementation(async (id: number) => [transcript(id)])
    switchApi.mockReset().mockResolvedValue(undefined)
    insertAndSwitchApi.mockReset().mockResolvedValue(undefined)
    Object.assign(window, {
      api: { transcripts: { list, switch: switchApi, insertAndSwitch: insertAndSwitchApi } }
    })
    pinia = createQueryPinia()
  })

  afterEach(() => hosts.splice(0).forEach((host) => host.unmount()))

  it('loads the transcripts of the variant', async () => {
    const { transcripts, loading, error } = mountTranscripts()
    expect(loading.value).toBe(true)
    await flushPromises()

    expect(list).toHaveBeenCalledExactlyOnceWith(10)
    expect(transcripts.value).toEqual([transcript(10)])
    expect(loading.value).toBe(false)
    expect(error.value).toBeNull()
  })

  it('reads nothing and is not loading without a variant', async () => {
    const { transcripts, loading, variantId } = mountTranscripts()
    await flushPromises()

    variantId.value = null
    await flushPromises()
    expect(transcripts.value).toEqual([])
    expect(loading.value).toBe(false)
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('never shows the previous variant when its response arrives last', async () => {
    let resolveFirst: (value: TranscriptAnnotation[]) => void = () => {}
    list.mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
    const { transcripts, variantId } = mountTranscripts()
    await flushPromises()

    variantId.value = 20
    await flushPromises()
    resolveFirst([transcript(10)])
    await flushPromises()

    expect(transcripts.value).toEqual([transcript(20)])
  })

  it('does not show the error of a superseded request', async () => {
    let rejectFirst: (reason: unknown) => void = () => {}
    list.mockImplementationOnce(() => new Promise((_, reject) => (rejectFirst = reject)))
    const { transcripts, error, variantId } = mountTranscripts()
    await flushPromises()

    variantId.value = 20
    await flushPromises()
    rejectFirst(new Error('late failure'))
    await flushPromises()

    expect(error.value).toBeNull()
    expect(transcripts.value).toEqual([transcript(20)])
  })

  it('reports a failed load and shows no transcripts', async () => {
    list.mockResolvedValue(failure)
    const { transcripts, loading, error } = mountTranscripts()
    await flushPromises()

    expect(transcripts.value).toEqual([])
    expect(loading.value).toBe(false)
    expect(error.value).toBe('Database busy')
  })

  it("does not show another database's transcripts for the same variant id", async () => {
    const { transcripts } = mountTranscripts()
    await flushPromises()
    list.mockResolvedValue([transcript(10, 'OTHER-DB')])

    useDatabaseStore().revision++
    await invalidateServerData('database-switch')
    await flushPromises()

    expect(transcripts.value).toEqual([transcript(10, 'OTHER-DB')])
  })

  it('refetches once after an import or a case delete', async () => {
    mountTranscripts()
    await flushPromises()
    list.mockClear()

    await invalidateServerData('data-changed')
    await flushPromises()
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('switching refetches the list before it resolves', async () => {
    const { transcripts, switchTranscript } = mountTranscripts()
    await flushPromises()
    list.mockResolvedValue([transcript(10, 'ENST-NEW')])

    await expect(switchTranscript('ENST-NEW')).resolves.toBe(true)
    expect(switchApi).toHaveBeenCalledWith(10, 'ENST-NEW')
    expect(transcripts.value).toEqual([transcript(10, 'ENST-NEW')])
  })

  it('insert-and-switch refetches the list before it resolves', async () => {
    const row = { transcript_id: 'ENST-VEP' } as TranscriptInsertRow
    const { transcripts, insertAndSwitch } = mountTranscripts()
    await flushPromises()
    list.mockResolvedValue([transcript(10), transcript(10, 'ENST-VEP')])

    await expect(insertAndSwitch(row)).resolves.toBe(true)
    expect(insertAndSwitchApi).toHaveBeenCalledWith(10, row)
    expect(transcripts.value).toHaveLength(2)
  })

  it('a failed switch returns false, reports the error and leaves the list alone', async () => {
    const { transcripts, error, switchTranscript, variantId } = mountTranscripts()
    await flushPromises()
    list.mockClear()
    switchApi.mockResolvedValue(failure)

    await expect(switchTranscript('ENST-NEW')).resolves.toBe(false)
    expect(list).not.toHaveBeenCalled()
    expect(transcripts.value).toEqual([transcript(10)])
    expect(error.value).toBe('Database busy')

    variantId.value = 20
    await flushPromises()
    expect(error.value).toBeNull()
  })

  it('a switch still succeeds when the refetch after it fails', async () => {
    const { switchTranscript } = mountTranscripts()
    await flushPromises()
    list.mockResolvedValue(failure)

    await expect(switchTranscript('ENST-NEW')).resolves.toBe(true)
  })

  it('does nothing without a variant', async () => {
    const { switchTranscript } = mountTranscripts(ref(null))
    await expect(switchTranscript('ENST-NEW')).resolves.toBe(false)
    expect(switchApi).not.toHaveBeenCalled()
  })

  it('a switch that settles after the variant changed reports nothing on the new variant', async () => {
    let failSwitch: (value: unknown) => void = () => {}
    switchApi.mockImplementationOnce(() => new Promise((resolve) => (failSwitch = resolve)))
    const { error, switchTranscript, variantId } = mountTranscripts()
    await flushPromises()
    const pending = switchTranscript('ENST-NEW')

    variantId.value = 20
    await flushPromises()
    failSwitch(failure)

    await expect(pending).resolves.toBe(false)
    expect(error.value).toBeNull()
  })
})
