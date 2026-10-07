/**
 * Cohort summary after a SQLite multi-file import.
 *
 * The import worker merges the first file into `cohort_variant_summary`
 * exactly; the remaining files are appended on the main thread and are not
 * merged. The import must therefore end with a rebuild — and tell the
 * renderer while it runs — instead of leaving the summary flagged stale with
 * nothing to rebuild it.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DatabaseService } from '../../../src/main/database/DatabaseService'
import { makeVariant } from '../../utils/make-variant'

type Coord = [string, number, string, string]

const appendPlan = new Map<string, Coord[]>()
/** `is_stale` as each append found it, before it wrote anything. */
const staleWhenAppending: boolean[] = []

vi.mock('../../../src/main/ipc/handlers/import-logic-append', () => ({
  detectGenomeBuildFromFile: vi.fn(async () => null),
  importAdditionalFileToCase: vi.fn(
    async (caseId: number, filePath: string, _o: unknown, getDb: () => DatabaseService) => {
      const coords = appendPlan.get(filePath) ?? []
      staleWhenAppending.push(getDb().cohortSummary.getStatus().is_stale)
      getDb().variants.insertVariantsBatch(caseId, coords.map(toVariant))
      return { caseId, variantCount: coords.length, skipped: 0, errors: [], elapsed: 0 }
    }
  )
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

describe('SQLite multi-file import cohort summary', () => {
  let dir: string
  let db: DatabaseService

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'varlens-mf-summary-'))
    db = new DatabaseService(join(dir, 'test.db'))
    appendPlan.clear()
    staleWhenAppending.length = 0
    spawnRebuildWorker.mockReset()
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
        db.variants.updateFrequencies(caseId)
        db.cohortSummary.rebuild()
        return { caseId, variantCount: firstFileCoords.length, skipped: 0, errors: [], elapsed: 0 }
      }),
      importMultiFile: vi.fn(),
      cancel: vi.fn()
    }
  }

  function file(name: string, coords: Coord[]): string {
    const path = join(dir, name)
    writeFileSync(path, '##fileformat=VCFv4.2\n')
    appendPlan.set(path, coords)
    return path
  }

  const spec = (filePath: string) => ({
    filePath,
    variantType: 'snv-indel',
    caller: null,
    annotationFormat: null
  })

  function runImport(files: string[], events: string[]) {
    const executor = workerExecutor([['1', 100, 'A', 'G']])
    const session = { capabilities: { backend: 'sqlite' }, getImportExecutor: () => executor }
    return startMultiFileImport(
      'merged',
      files.map(spec),
      undefined,
      () => session as never,
      () => db,
      { onCohortStale: (d) => events.push(d.phase ? `stale:${d.phase}` : `stale:${d.is_stale}`) }
    )
  }

  it('rebuilds the summary the appended files left behind and reports it', async () => {
    const events: string[] = []
    let staleDuringRebuild: boolean | null = null
    let rowsBeforeRebuild: string[] = []
    spawnRebuildWorker.mockImplementation(
      async (dbPath: string, _key: unknown, onProgress: (p: unknown) => void) => {
        expect(dbPath).toBe(db.getPath())
        staleDuringRebuild = db.cohortSummary.getStatus().is_stale
        rowsBeforeRebuild = summaryRows(db)
        onProgress({ phase: 'variants', phase_index: 1, phase_total: 2, label: 'Variants' })
        db.cohortSummary.rebuild()
      }
    )

    const result = await runImport(
      [file('first.vcf', []), file('sv.vcf', [['1', 200, 'C', 'T']])],
      events
    )

    expect(result.files.every((f) => f.error === undefined)).toBe(true)
    // The appended coordinate really was missing: the summary was out of date.
    expect(rowsBeforeRebuild).toEqual(['1:100:A>G=1'])
    expect(staleDuringRebuild).toBe(true)
    expect(summaryRows(db)).toEqual(['1:100:A>G=1', '1:200:C>T=1'])
    expect(db.cohortSummary.getStatus().is_stale).toBe(false)
    expect(events).toEqual(['stale:true', 'stale:variants', 'stale:false'])
  })

  it('flags the summary stale before the first append, not after the last', async () => {
    spawnRebuildWorker.mockImplementation(async () => db.cohortSummary.rebuild())

    await runImport(
      [
        file('first.vcf', []),
        file('sv.vcf', [['1', 200, 'C', 'T']]),
        file('cnv.vcf', [['1', 300, 'G', 'A']])
      ],
      []
    )

    // A crash during or between the appends must not leave appended variants
    // outside a summary that claims to be current.
    expect(staleWhenAppending).toEqual([true, true])
    expect(db.cohortSummary.getStatus().is_stale).toBe(false)
  })

  it('leaves the summary flagged stale, and says so, when the rebuild fails', async () => {
    const events: string[] = []
    spawnRebuildWorker.mockRejectedValue(new Error('rebuild boom'))

    const result = await runImport(
      [file('first.vcf', []), file('sv.vcf', [['1', 200, 'C', 'T']])],
      events
    )

    expect(result.totalVariants).toBe(2)
    expect(db.cohortSummary.getStatus().is_stale).toBe(true)
    expect(events).toEqual(['stale:true'])
  })

  it('does not touch the summary for a single file: the worker kept it exact', async () => {
    const events: string[] = []

    await runImport([file('first.vcf', [])], events)

    expect(spawnRebuildWorker).not.toHaveBeenCalled()
    expect(db.cohortSummary.getStatus().is_stale).toBe(false)
    expect(events).toEqual([])
  })
})
