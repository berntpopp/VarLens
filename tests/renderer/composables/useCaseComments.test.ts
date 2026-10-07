/**
 * useCaseComments: one case's comments, read from the query cache, and the
 * writes that refetch them.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import type { Pinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { useCaseComments } from '@renderer/composables/useCaseComments'
import type { CaseComment } from '../../../src/shared/types/api'
import { invalidateServerData } from '../../../src/renderer/src/queries/invalidation'
import { useDatabaseStore } from '../../../src/renderer/src/stores/databaseStore'
import { MOCK_SQLITE_CAPABILITIES } from '../../../src/renderer/src/mocks/mockApi'
import { createQueryPinia, withQueries } from '../helpers/with-queries'
import { installCapabilities } from '../helpers/capabilities'

vi.mock('../../../src/renderer/src/services/LogService', () => ({
  logService: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

const comment = (caseId: number, id = caseId * 10, content = `comment ${id}`): CaseComment =>
  ({ id, case_id: caseId, category: 'Clinical Note', content }) as CaseComment

const failure = { code: 'DB_ERROR', message: 'boom', userMessage: 'boom' }

describe('useCaseComments', () => {
  const list = vi.fn()
  const create = vi.fn()
  const update = vi.fn()
  const remove = vi.fn()
  const hosts: Array<{ unmount: () => void }> = []
  let pinia: Pinia

  function mountComments(caseId = ref(1)) {
    const host = withQueries(() => useCaseComments(caseId), pinia)
    hosts.push(host)
    return { ...host.result, caseId }
  }

  beforeEach(() => {
    list.mockReset().mockImplementation(async (caseId: number) => [comment(caseId)])
    create.mockReset().mockResolvedValue(comment(1, 99))
    update.mockReset().mockResolvedValue(comment(1, 10, 'edited'))
    remove.mockReset().mockResolvedValue(undefined)
    Object.assign(window, { api: { caseComments: { list, create, update, delete: remove } } })
    pinia = createQueryPinia()
  })

  afterEach(() => hosts.splice(0).forEach((host) => host.unmount()))

  it('loads the comments of the case and reports loading until they arrive', async () => {
    const { comments, isLoading } = mountComments(ref(7))
    expect(comments.value).toEqual([])
    expect(isLoading.value).toBe(true)

    await flushPromises()
    expect(list).toHaveBeenCalledExactlyOnceWith(7)
    expect(comments.value).toEqual([comment(7)])
    expect(isLoading.value).toBe(false)
  })

  it('reads nothing for case id 0', async () => {
    const { comments } = mountComments(ref(0))
    await flushPromises()
    expect(list).not.toHaveBeenCalled()
    expect(comments.value).toEqual([])
  })

  it('reads nothing while the backend does not support comments', async () => {
    installCapabilities({
      storage: {
        ...MOCK_SQLITE_CAPABILITIES,
        workflow: { ...MOCK_SQLITE_CAPABILITIES.workflow, caseComments: false }
      }
    })
    mountComments()
    await flushPromises()
    expect(list).not.toHaveBeenCalled()
  })

  it('shares one request between consumers of the same case', async () => {
    mountComments()
    const second = mountComments()
    await flushPromises()
    expect(list).toHaveBeenCalledTimes(1)
    expect(second.comments.value).toEqual([comment(1)])
  })

  it('refetches when a view showing the case mounts again', async () => {
    mountComments()
    await flushPromises()
    list.mockResolvedValue([comment(1, 11), comment(1, 10)])

    const later = mountComments()
    await flushPromises()
    expect(later.comments.value.map((c) => c.id)).toEqual([11, 10])
  })

  it('never shows the previous case when its response arrives last', async () => {
    let resolveFirst: (value: CaseComment[]) => void = () => {}
    list.mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
    const { comments, caseId } = mountComments()
    await flushPromises()

    caseId.value = 2
    await flushPromises()
    resolveFirst([comment(1)])
    await flushPromises()

    expect(comments.value).toEqual([comment(2)])
  })

  it("does not show another database's comments for the same case id", async () => {
    let resolveOld: (value: CaseComment[]) => void = () => {}
    list.mockImplementationOnce(() => new Promise((resolve) => (resolveOld = resolve)))
    const { comments } = mountComments()
    await flushPromises()
    list.mockResolvedValue([comment(1, 500, 'other database')])

    useDatabaseStore().revision++
    await invalidateServerData('database-switch')
    await flushPromises()
    resolveOld([comment(1)])
    await flushPromises()

    expect(comments.value.map((c) => c.content)).toEqual(['other database'])
  })

  it('refetches once after an import or a case delete', async () => {
    const { comments } = mountComments()
    await flushPromises()
    list.mockClear().mockResolvedValue([])

    await invalidateServerData('data-changed')
    await flushPromises()

    expect(list).toHaveBeenCalledTimes(1)
    expect(comments.value).toEqual([])
  })

  it('create, update and delete refetch the list before they resolve', async () => {
    const { comments, createComment, updateComment, deleteComment } = mountComments()
    await flushPromises()

    list.mockResolvedValue([comment(1, 99), comment(1)])
    await expect(createComment('Clinical Note', 'new')).resolves.toEqual(comment(1, 99))
    expect(create).toHaveBeenCalledWith(1, 'Clinical Note', 'new')
    expect(comments.value.map((c) => c.id)).toEqual([99, 10])

    list.mockResolvedValue([comment(1, 99), comment(1, 10, 'edited')])
    await updateComment(10, 'edited')
    expect(update).toHaveBeenCalledWith(10, 'edited')
    expect(comments.value[1].content).toBe('edited')

    list.mockResolvedValue([comment(1, 99)])
    await deleteComment(10)
    expect(remove).toHaveBeenCalledWith(10)
    expect(comments.value.map((c) => c.id)).toEqual([99])
  })

  it('a failed write rejects and leaves the list alone', async () => {
    const { comments, deleteComment } = mountComments()
    await flushPromises()
    list.mockClear()
    remove.mockResolvedValue(failure)

    await expect(deleteComment(10)).rejects.toMatchObject({ code: 'DB_ERROR' })
    expect(list).not.toHaveBeenCalled()
    expect(comments.value).toEqual([comment(1)])
  })

  it('a write still succeeds when the refetch after it fails', async () => {
    const { comments, createComment } = mountComments()
    await flushPromises()
    list.mockResolvedValue(failure)

    await expect(createComment('Clinical Note', 'new')).resolves.toEqual(comment(1, 99))
    expect(comments.value).toEqual([comment(1)])
  })

  it('a write that settles after a database switch does not touch the new database', async () => {
    let finishWrite: (value: CaseComment) => void = () => {}
    create.mockImplementationOnce(() => new Promise((resolve) => (finishWrite = resolve)))
    const { comments, createComment } = mountComments()
    await flushPromises()
    const write = createComment('Clinical Note', 'new')

    list.mockResolvedValue([comment(1, 500, 'other database')])
    useDatabaseStore().revision++
    await invalidateServerData('database-switch')
    await flushPromises()
    list.mockClear()
    finishWrite(comment(1, 99))
    await write
    await flushPromises()

    expect(list).not.toHaveBeenCalled()
    expect(comments.value.map((c) => c.content)).toEqual(['other database'])
  })
})
