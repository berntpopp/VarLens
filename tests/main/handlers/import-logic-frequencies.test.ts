/**
 * Cohort allele counts (variant_frequency) after a SQLite multi-file import
 * must equal a full recompute. The first file goes through the import worker
 * (which counts the case once per coordinate); the remaining files are
 * appended on the main thread. The append bookkeeping must count the case
 * once for coordinates that only the appended files contribute.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DatabaseService } from '../../../src/main/database/DatabaseService'
import { makeVariant } from '../../utils/make-variant'

type Coord = [string, number, string, string]

/** Variants each fake append file inserts, keyed by file path. */
const appendPlan = new Map<string, Coord[]>()

vi.mock('../../../src/main/ipc/handlers/import-logic-append', () => ({
  detectGenomeBuildFromFile: vi.fn(async () => null),
  importAdditionalFileToCase: vi.fn(
    async (caseId: number, filePath: string, _o: unknown, getDb: () => DatabaseService) => {
      const coords = appendPlan.get(filePath) ?? []
      getDb().variants.insertVariantsBatch(caseId, coords.map(toVariant))
      return { caseId, variantCount: coords.length, skipped: 0, errors: [], elapsed: 0 }
    }
  )
}))

const { startMultiFileImport } = await import('../../../src/main/ipc/handlers/import-logic')

function toVariant([chr, pos, ref, alt]: Coord): ReturnType<typeof makeVariant> {
  return makeVariant({ chr, pos, ref, alt, gene_symbol: null, consequence: null })
}

function frequencyTable(db: DatabaseService): string[] {
  return (
    db.database
      .prepare(
        'SELECT chr, pos, ref, alt, case_count FROM variant_frequency ORDER BY chr, pos, ref, alt'
      )
      .all() as Array<Record<string, unknown>>
  ).map((r) => `${r.chr}:${r.pos}:${r.ref}>${r.alt}=${r.case_count}`)
}

function recomputed(db: DatabaseService): string[] {
  return (
    db.database
      .prepare(
        `SELECT chr, pos, ref, alt, COUNT(DISTINCT case_id) AS case_count FROM variants
          GROUP BY chr, pos, ref, alt ORDER BY chr, pos, ref, alt`
      )
      .all() as Array<Record<string, unknown>>
  ).map((r) => `${r.chr}:${r.pos}:${r.ref}>${r.alt}=${r.case_count}`)
}

describe('SQLite multi-file import frequency bookkeeping', () => {
  let dir: string
  let db: DatabaseService

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'varlens-mf-freq-'))
    db = new DatabaseService(join(dir, 'test.db'))
    appendPlan.clear()
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  /** Stand-in for the import worker: create the case, insert, count once. */
  function workerExecutor(firstFileCoords: Coord[]) {
    return {
      importSingleFile: vi.fn(async ({ caseName }: { caseName: string }) => {
        const caseId = db.cases.createCase(caseName, '/x/first.vcf', 1)
        db.variants.insertVariantsBatch(caseId, firstFileCoords.map(toVariant))
        db.variants.updateFrequencies(caseId)
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

  it('counts appended-only coordinates that other cases already carry', async () => {
    // An existing case already holds 1:200 and 1:300.
    const other = db.cases.createCase('other', '/x/other.vcf', 1)
    db.variants.insertVariantsBatch(other, [
      toVariant(['1', 200, 'C', 'T']),
      toVariant(['1', 300, 'G', 'A'])
    ])
    db.variants.updateFrequencies(other)

    const first = file('first.vcf', [])
    const sv = file('sv.vcf', [
      ['1', 200, 'C', 'T'], // only in the appended file, shared with "other"
      ['1', 100, 'A', 'G'] // also in the first file
    ])
    const cnv = file('cnv.vcf', [['1', 400, 'T', 'C']]) // brand new coordinate

    const executor = workerExecutor([
      ['1', 100, 'A', 'G'],
      ['1', 300, 'G', 'A']
    ])
    const session = { capabilities: { backend: 'sqlite' }, getImportExecutor: () => executor }
    const spec = (filePath: string) => ({
      filePath,
      variantType: 'snv-indel',
      caller: null,
      annotationFormat: null
    })

    const result = await startMultiFileImport(
      'merged',
      [spec(first), spec(sv), spec(cnv)],
      undefined,
      () => session as never,
      () => db,
      {}
    )

    expect(result.files.every((f) => f.error === undefined)).toBe(true)
    expect(frequencyTable(db)).toEqual(recomputed(db))
    expect(frequencyTable(db)).toContain('1:200:C>T=2')
  })
})
