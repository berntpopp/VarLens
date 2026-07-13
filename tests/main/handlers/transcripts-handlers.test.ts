import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    removeAllListeners: vi.fn()
  },
  app: {
    getPath: vi.fn(() => '/tmp/varlens-test')
  }
}))

describe('transcript PostgreSQL executor routing', () => {
  it('routes transcript reads and writes through the current Postgres session executors', async () => {
    const readExecute = vi.fn().mockResolvedValue([{ transcript_id: 'NM_000059.4' }])
    const writeExecute = vi.fn().mockResolvedValue({ success: true })
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
        handlers.set(channel, handler)
      })
    }
    const { registerTranscriptHandlers } =
      await import('../../../src/main/ipc/handlers/transcripts')
    const transcript = {
      transcript_id: 'NM_000059.4',
      gene_symbol: 'BRCA2',
      consequence: 'HIGH',
      func: 'missense_variant',
      cdna: 'c.1A>G',
      aa_change: 'p.M1V',
      hpo_sim_score: 0.8,
      moi: 'AD',
      is_selected: 0
    }

    registerTranscriptHandlers({
      ipcMain: ipcMain as never,
      getDb: (() => {
        throw new Error('getDb should not be called for postgres transcripts')
      }) as never,
      getDbManager: (() => ({
        getCurrentSession: () => ({
          capabilities: { backend: 'postgres' },
          getReadExecutor: () => ({ execute: readExecute }),
          getWriteExecutor: () => ({ execute: writeExecute })
        })
      })) as never
    })

    await expect(handlers.get('transcripts:list')!(undefined, 9)).resolves.toEqual([
      { transcript_id: 'NM_000059.4' }
    ])
    await expect(handlers.get('transcripts:switch')!(undefined, 9, 'NM_000059.4')).resolves.toEqual(
      { success: true }
    )
    await expect(
      handlers.get('transcripts:insertAndSwitch')!(undefined, 9, transcript)
    ).resolves.toEqual({ success: true })

    expect(readExecute).toHaveBeenCalledWith({ type: 'transcripts:list', params: [9] })
    expect(writeExecute).toHaveBeenNthCalledWith(1, {
      type: 'transcripts:switch',
      params: [9, 'NM_000059.4']
    })
    expect(writeExecute).toHaveBeenNthCalledWith(2, {
      type: 'transcripts:insertAndSwitch',
      params: [9, transcript]
    })
  })

  it('rejects a non-IMPACT consequence before it reaches a write executor', async () => {
    const writeExecute = vi.fn()
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
        handlers.set(channel, handler)
      })
    }
    const { registerTranscriptHandlers } =
      await import('../../../src/main/ipc/handlers/transcripts')

    registerTranscriptHandlers({
      ipcMain: ipcMain as never,
      getDb: vi.fn() as never,
      getDbManager: (() => ({
        getCurrentSession: () => ({
          capabilities: { backend: 'postgres' },
          getWriteExecutor: () => ({ execute: writeExecute })
        })
      })) as never
    })

    const result = await handlers.get('transcripts:insertAndSwitch')!(undefined, 9, {
      transcript_id: 'NM_BAD.1',
      gene_symbol: 'BRCA2',
      consequence: 'stop_gained',
      func: 'stop_gained',
      cdna: null,
      aa_change: null,
      hpo_sim_score: null,
      moi: null,
      is_selected: 0
    })

    expect(result).toMatchObject({ code: 'UNKNOWN', message: 'Invalid parameters' })
    expect(writeExecute).not.toHaveBeenCalled()
  })
})
