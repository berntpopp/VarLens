import { describe, expect, it, vi } from 'vitest'
import { registerCaseMetadataHandlers } from '../../../src/main/ipc/handlers/case-metadata'

type RegisteredHandler = (...args: unknown[]) => Promise<unknown>

function setupHandlers() {
  const readExecute = vi.fn()
  const writeExecute = vi.fn()
  const registered = new Map<string, RegisteredHandler>()
  const ipcMain = {
    handle: vi.fn((channel: string, handler: RegisteredHandler) => {
      registered.set(channel, handler)
    })
  } as never

  registerCaseMetadataHandlers({
    ipcMain,
    getDb: (() => {
      throw new Error('getDb should not be called for postgres case metadata')
    }) as never,
    getDbManager: (() => ({
      getCurrentSession: () => ({
        getReadExecutor: () => ({ execute: readExecute }),
        getWriteExecutor: () => ({ execute: writeExecute })
      })
    })) as never,
    getDbPool: (() => {
      throw new Error('getDbPool should not be called for postgres case metadata')
    }) as never
  })

  return { readExecute, registered, writeExecute }
}

describe('case-metadata IPC storage session routing', () => {
  it('routes case-metadata:get through the active read executor', async () => {
    const expected = { case_id: 1, affected_status: 'affected' }
    const { readExecute, registered } = setupHandlers()
    readExecute.mockResolvedValue(expected)

    const result = await registered.get('case-metadata:get')!(undefined, 1)

    expect(result).toBe(expected)
    expect(readExecute).toHaveBeenCalledWith({
      type: 'case-metadata:get',
      params: [1]
    })
  })

  it('routes case-metadata:upsert through the active write executor without stripping age fields', async () => {
    const expected = { case_id: 1, age: 42, date_of_birth: '1984-01-02' }
    const { registered, writeExecute } = setupHandlers()
    writeExecute.mockResolvedValue(expected)

    const updates = {
      affected_status: 'affected',
      age: 42,
      date_of_birth: '1984-01-02'
    }
    const result = await registered.get('case-metadata:upsert')!(undefined, 1, updates)

    expect(result).toBe(expected)
    expect(writeExecute).toHaveBeenCalledWith({
      type: 'case-metadata:upsert',
      params: [1, updates]
    })
  })

  it('routes case-metadata:listCohorts through the active read executor', async () => {
    const expected = [{ id: 2, name: 'research' }]
    const { readExecute, registered } = setupHandlers()
    readExecute.mockResolvedValue(expected)

    const result = await registered.get('case-metadata:listCohorts')!(undefined)

    expect(result).toBe(expected)
    expect(readExecute).toHaveBeenCalledWith({
      type: 'case-metadata:listCohorts',
      params: []
    })
  })

  it('routes case-metadata:assignHpoTerm through the active write executor', async () => {
    const expected = { case_id: 1, hpo_id: 'HP:0001250', hpo_label: 'Seizure' }
    const { registered, writeExecute } = setupHandlers()
    writeExecute.mockResolvedValue(expected)

    const result = await registered.get('case-metadata:assignHpoTerm')!(
      undefined,
      1,
      'HP:0001250',
      'Seizure'
    )

    expect(result).toBe(expected)
    expect(writeExecute).toHaveBeenCalledWith({
      type: 'case-metadata:assignHpoTerm',
      params: [1, 'HP:0001250', 'Seizure']
    })
  })

  it('passes assignHpoTerm status flags through and rejects malformed ones', async () => {
    const { registered, writeExecute } = setupHandlers()
    const assign = registered.get('case-metadata:assignHpoTerm')!

    await assign(undefined, 1, 'HP:0000252', 'Microcephaly', { excluded: true })
    expect(writeExecute).toHaveBeenCalledWith({
      type: 'case-metadata:assignHpoTerm',
      params: [1, 'HP:0000252', 'Microcephaly', { excluded: true }]
    })

    writeExecute.mockClear()
    const rejected = await assign(undefined, 1, 'HP:0000252', 'Microcephaly', { excluded: 'yes' })
    expect(rejected).toMatchObject({ message: 'Invalid parameters' })
    expect(writeExecute).not.toHaveBeenCalled()
  })

  it('routes case-metadata:getFullMetadata through the active read executor', async () => {
    const expected = {
      metadata: null,
      cohorts: [],
      hpoTerms: [],
      comments: [],
      metrics: [],
      dataInfo: null,
      externalIds: []
    }
    const { readExecute, registered } = setupHandlers()
    readExecute.mockResolvedValue(expected)

    const result = await registered.get('case-metadata:getFullMetadata')!(undefined, 1)

    expect(result).toBe(expected)
    expect(readExecute).toHaveBeenCalledWith({
      type: 'case-metadata:getFullMetadata',
      params: [1]
    })
  })
})
