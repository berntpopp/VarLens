/**
 * A single-file import whose worker stops keeping the cohort summary current
 * (the session-start rebuild failed, the merge threw, the summary was rewritten
 * behind its back) must tell the renderer, like a batch does: an open cohort
 * view would otherwise show a summary that lacks the case just imported, with
 * no banner — and must hear when the summary is current again.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const spawnRebuildWorker = vi.hoisted(() => vi.fn())
vi.mock('../../../src/main/ipc/handlers/cohort-logic', () => ({ spawnRebuildWorker }))
vi.mock('../../../src/main/ipc/handlers/import-logic-append', () => ({
  detectGenomeBuildFromFile: vi.fn(async () => null),
  importAdditionalFileToCase: vi.fn()
}))

const { startImport, startMultiFileImport } =
  await import('../../../src/main/ipc/handlers/import-logic')

interface SingleFileParams {
  onSummaryStale?: () => void
}

const RESULT = { caseId: 7, variantCount: 3, skipped: 0, errors: [], elapsed: 1 }

function makeDb(state: { stale: boolean }) {
  return {
    cohort: { invalidateColumnMetaCache: vi.fn() },
    cohortSummary: { getStatus: () => ({ is_stale: state.stale, last_rebuilt_at: 0 }) },
    needsStartupRebuild: () => false,
    getPath: () => '/data/test.db',
    getEncryptionKey: () => undefined,
    cases: { insertImportFile: vi.fn(), getCase: () => ({ genome_build: 'GRCh38' }) },
    variants: { recalculateCaseVariantCount: vi.fn() }
  }
}

/** A session whose executor runs `duringImport` with the params it was given. */
function makeSession(backend: string, duringImport: (params: SingleFileParams) => void) {
  const importSingleFile = vi.fn(async (params: SingleFileParams) => {
    duringImport(params)
    return RESULT
  })
  return {
    importSingleFile,
    session: {
      capabilities: { backend },
      getImportExecutor: () => ({ importSingleFile, importMultiFile: vi.fn(), cancel: vi.fn() })
    }
  }
}

describe('single-file import: cohort staleness', () => {
  let events: string[]
  const callbacks = {
    onCohortStale: (d: { is_stale: boolean; phase?: string }) =>
      events.push(d.phase !== undefined ? `stale:${d.phase}` : `stale:${d.is_stale}`)
  }

  beforeEach(() => {
    events = []
    spawnRebuildWorker.mockReset()
  })

  it('forwards the stale notice at once and reports the summary current at the end', async () => {
    const state = { stale: false }
    const seenDuringImport: string[][] = []
    const { session } = makeSession('sqlite', (params) => {
      state.stale = true
      params.onSummaryStale?.()
      seenDuringImport.push([...events])
      state.stale = false // the worker's rebuild at session end
    })

    await startImport(
      '/data/a.vcf',
      'a',
      undefined,
      () => session as never,
      callbacks,
      () => makeDb(state) as never
    )

    expect(seenDuringImport).toEqual([['stale:true']])
    expect(events).toEqual(['stale:true', 'stale:false'])
    expect(spawnRebuildWorker).not.toHaveBeenCalled()
  })

  it('says nothing when the worker kept the summary current', async () => {
    const db = makeDb({ stale: false })
    const { session } = makeSession('sqlite', () => undefined)

    await startImport(
      '/data/a.vcf',
      'a',
      undefined,
      () => session as never,
      callbacks,
      () => db as never
    )

    expect(events).toEqual([])
    expect(db.cohort.invalidateColumnMetaCache).toHaveBeenCalled()
  })

  it('repairs a summary the worker left stale, without a second stale notice', async () => {
    const state = { stale: false }
    spawnRebuildWorker.mockImplementation(async (_p: string, _k: unknown, onProgress) => {
      onProgress({ phase: 'variant_summary', phase_index: 1, phase_total: 3, label: 'x' })
      state.stale = false
    })
    const { session } = makeSession('sqlite', (params) => {
      state.stale = true // and the worker's own rebuild fails
      params.onSummaryStale?.()
    })

    await startImport(
      '/data/a.vcf',
      'a',
      undefined,
      () => session as never,
      callbacks,
      () => makeDb(state) as never
    )

    expect(spawnRebuildWorker).toHaveBeenCalledTimes(1)
    expect(events).toEqual(['stale:true', 'stale:variant_summary', 'stale:false'])
  })

  it('settles nothing without a SQLite database (PostgreSQL session)', async () => {
    const { session, importSingleFile } = makeSession('postgres', () => undefined)

    await startImport('/data/a.vcf', 'a', undefined, () => session as never, callbacks)

    expect(importSingleFile).toHaveBeenCalledTimes(1)
    expect(events).toEqual([])
    expect(spawnRebuildWorker).not.toHaveBeenCalled()
  })

  it('takes the banner down after a failed import', async () => {
    const state = { stale: false }
    const importSingleFile = vi.fn(async (params: SingleFileParams) => {
      params.onSummaryStale?.()
      throw new Error('import failed')
    })
    const session = {
      capabilities: { backend: 'sqlite' },
      getImportExecutor: () => ({ importSingleFile, importMultiFile: vi.fn(), cancel: vi.fn() })
    }

    await expect(
      startImport(
        '/data/a.vcf',
        'a',
        undefined,
        () => session as never,
        callbacks,
        () => makeDb(state) as never
      )
    ).rejects.toThrow(/import failed/)

    expect(events).toEqual(['stale:true', 'stale:false'])
  })

  it('does the same for a multi-file import of one file', async () => {
    const state = { stale: false }
    const { session } = makeSession('sqlite', (params) => {
      state.stale = true
      params.onSummaryStale?.()
      state.stale = false
    })

    await startMultiFileImport(
      'merged',
      [{ filePath: '/nope/a.vcf', variantType: 'snv-indel', caller: null, annotationFormat: null }],
      undefined,
      () => session as never,
      () => makeDb(state) as never,
      callbacks
    )

    expect(events).toEqual(['stale:true', 'stale:false'])
    expect(spawnRebuildWorker).not.toHaveBeenCalled()
  })
})
