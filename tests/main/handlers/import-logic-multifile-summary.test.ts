/**
 * SQLite multi-file import, main-process side (#551).
 *
 * The first file goes through the executor's worker; files 2..N are checked
 * against the case's build here and handed to the import worker in ONE
 * session (appendFilesInWorker), which appends each file in its own
 * transaction and rebuilds the cohort summary itself. The main process only
 * records provenance, aggregates the outcome and repairs a summary the worker
 * could not.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DatabaseService } from '../../../src/main/database/DatabaseService'
import type { AppendFilesParams } from '../../../src/main/ipc/handlers/import-logic-append'
import { makeVariant } from '../../utils/make-variant'

type Coord = [string, number, string, string]

const appendPlan = new Map<string, Coord[]>()
const builds = new Map<string, string | null>()
/** What the stand-in worker does to the summary at its session end. */
let workerLeavesSummaryStale = false

const appendFilesInWorker = vi.hoisted(() => vi.fn())
vi.mock('../../../src/main/ipc/handlers/import-logic-append', () => ({
  detectGenomeBuildFromFile: vi.fn(async (path: string) => builds.get(path) ?? null),
  appendFilesInWorker
}))

// Stand-in for the rebuild worker thread: each test decides what it does.
const spawnRebuildWorker = vi.hoisted(() => vi.fn())
vi.mock('../../../src/main/ipc/handlers/cohort-logic', () => ({ spawnRebuildWorker }))

const { startMultiFileImport } = await import('../../../src/main/ipc/handlers/import-logic')

function toVariant([chr, pos, ref, alt]: Coord): ReturnType<typeof makeVariant> {
  return makeVariant({ chr, pos, ref, alt, gene_symbol: null, consequence: null })
}

function summaryRows(db: DatabaseService): string[] {
  return (
    db.database
      .prepare(
        'SELECT chr, pos, ref, alt, carrier_count FROM cohort_variant_summary ORDER BY chr, pos, ref, alt'
      )
      .all() as Array<Record<string, unknown>>
  ).map((r) => `${r.chr}:${r.pos}:${r.ref}>${r.alt}=${r.carrier_count}`)
}

describe('SQLite multi-file import (main process)', () => {
  let dir: string
  let db: DatabaseService

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'varlens-mf-summary-'))
    db = new DatabaseService(join(dir, 'test.db'))
    appendPlan.clear()
    builds.clear()
    workerLeavesSummaryStale = false
    spawnRebuildWorker.mockReset()
    appendFilesInWorker.mockReset()
    // Stand-in for the worker session: rows, counts, stale flag, rebuild.
    appendFilesInWorker.mockImplementation(async (p: AppendFilesParams) => {
      p.onSummaryStale?.()
      const outcomes = p.filePaths.map((path) => {
        const coords = appendPlan.get(path) ?? []
        db.variants.insertVariantsBatch(p.caseId, coords.map(toVariant))
        return { variantCount: coords.length, skipped: 0 }
      })
      db.cohortSummary.markStale()
      if (!workerLeavesSummaryStale) db.cohortSummary.rebuild()
      return outcomes
    })
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  /** Stand-in for the import worker: the case and an exact summary for its first file. */
  function workerExecutor(firstFileCoords: Coord[]) {
    return {
      importSingleFile: vi.fn(async ({ caseName }: { caseName: string }) => {
        const caseId = db.cases.createCase(caseName, '/x/first.vcf', 1)
        db.variants.insertVariantsBatch(caseId, firstFileCoords.map(toVariant))
        db.cohortSummary.rebuild()
        return { caseId, variantCount: firstFileCoords.length, skipped: 0, errors: [], elapsed: 0 }
      }),
      importMultiFile: vi.fn(),
      cancel: vi.fn()
    }
  }

  function file(name: string, coords: Coord[], build: string | null = null): string {
    const path = join(dir, name)
    writeFileSync(path, '##fileformat=VCFv4.2\n')
    appendPlan.set(path, coords)
    builds.set(path, build)
    return path
  }

  const spec = (filePath: string) => ({
    filePath,
    variantType: 'snv-indel',
    caller: null,
    annotationFormat: null
  })

  function runImport(files: string[], events: string[] = [], filtersPayload?: object) {
    const executor = workerExecutor([['1', 100, 'A', 'G']])
    const session = { capabilities: { backend: 'sqlite' }, getImportExecutor: () => executor }
    return startMultiFileImport(
      'merged',
      files.map(spec),
      undefined,
      () => session as never,
      () => db,
      { onCohortStale: (d) => events.push(d.phase ? `stale:${d.phase}` : `stale:${d.is_stale}`) },
      filtersPayload as never
    )
  }

  it('hands files 2..N to one worker session and reports the summary current', async () => {
    const events: string[] = []
    const first = file('first.vcf', [])
    const sv = file('sv.vcf', [['1', 200, 'C', 'T']])
    const cnv = file('cnv.vcf', [['1', 300, 'G', 'A']])

    const result = await runImport([first, sv, cnv], events, {
      bedFile: '/x/r.bed',
      passOnly: true
    })

    expect(appendFilesInWorker).toHaveBeenCalledTimes(1)
    const params = appendFilesInWorker.mock.calls[0][0] as AppendFilesParams
    expect(params.filePaths).toEqual([sv, cnv])
    expect(params.caseId).toBe(result.caseId)
    expect(params.filters).toEqual(
      expect.objectContaining({ bedFilePath: '/x/r.bed', passOnly: true })
    )
    expect(result.files.map((f) => [f.filePath, f.variantCount, f.error])).toEqual([
      [first, 1, undefined],
      [sv, 1, undefined],
      [cnv, 1, undefined]
    ])
    expect(result.totalVariants).toBe(3)
    expect(db.cases.getImportFiles(result.caseId).map((f) => f.file_path)).toEqual([first, sv, cnv])
    // The worker rebuilt it: the main process does not.
    expect(spawnRebuildWorker).not.toHaveBeenCalled()
    expect(summaryRows(db)).toEqual(['1:100:A>G=1', '1:200:C>T=1', '1:300:G>A=1'])
    expect(events).toEqual(['stale:true', 'stale:false'])
  })

  it('repairs a summary the worker left stale', async () => {
    workerLeavesSummaryStale = true
    spawnRebuildWorker.mockImplementation(async () => db.cohortSummary.rebuild())

    await runImport([file('first.vcf', []), file('sv.vcf', [['1', 200, 'C', 'T']])])

    expect(spawnRebuildWorker).toHaveBeenCalledTimes(1)
    expect(db.cohortSummary.getStatus().is_stale).toBe(false)
  })

  it('refuses a file of another build before the worker sees it', async () => {
    const first = file('first.vcf', [], 'GRCh38')
    const other = file('other.vcf', [['1', 200, 'C', 'T']], 'GRCh37')
    const same = file('same.vcf', [['1', 300, 'G', 'A']], 'GRCh38')

    const result = await runImport([first, other, same])

    expect((appendFilesInWorker.mock.calls[0][0] as AppendFilesParams).filePaths).toEqual([same])
    expect(result.files.map((f) => [f.filePath, f.error !== undefined])).toEqual([
      [first, false],
      [other, true],
      [same, false]
    ])
  })

  it('reports a file the worker could not append, keeping the others', async () => {
    appendFilesInWorker.mockImplementation(async (p: AppendFilesParams) =>
      p.filePaths.map((_, i) =>
        i === 0 ? { variantCount: 0, skipped: 0, error: 'boom' } : { variantCount: 4, skipped: 1 }
      )
    )

    const result = await runImport([file('a.vcf', []), file('b.vcf', []), file('c.vcf', [])])

    expect(result.files.map((f) => f.error)).toEqual([undefined, 'boom', undefined])
    expect(result.totalVariants).toBe(5)
    expect(result.totalSkipped).toBe(1)
  })

  it('does not start a worker session for a single file', async () => {
    const events: string[] = []

    await runImport([file('first.vcf', [])], events)

    expect(appendFilesInWorker).not.toHaveBeenCalled()
    expect(spawnRebuildWorker).not.toHaveBeenCalled()
    expect(events).toEqual([])
  })

  it('hands the import filters to the worker that imports the first file (#484)', async () => {
    const executor = workerExecutor([])
    const session = { capabilities: { backend: 'sqlite' }, getImportExecutor: () => executor }

    await startMultiFileImport(
      'merged',
      [spec(file('first.vcf', []))],
      undefined,
      () => session as never,
      () => db,
      {},
      { bedFile: '/x/regions.bed', bedPadding: 20, passOnly: true, minQual: 30 }
    )

    expect(executor.importSingleFile).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({
          bedFilePath: '/x/regions.bed',
          bedPadding: 20,
          passOnly: true,
          minQual: 30
        })
      })
    )
  })
})
