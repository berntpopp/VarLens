// @vitest-environment node
/**
 * Unrecognised ClinVar values on the paths that had no direct test (#469):
 * the multi-file VCF import (main-thread append and the PostgreSQL executor
 * hand-over), the main-thread ImportService and the session batch loop.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseService } from '../../../../src/main/database/DatabaseService'
import { ImportService } from '../../../../src/main/import/ImportService'
import { importAdditionalFileToCase } from '../../../../src/main/ipc/handlers/import-logic-append'
import { startMultiFileImport } from '../../../../src/main/ipc/handlers/import-logic'
import { mergeUnrankedClinvar } from '../../../../src/main/import/unranked-clinvar'
import { runSessionBatchImport } from '../../../../src/main/ipc/handlers/batch-import-session'
import type { StorageSession } from '../../../../src/main/storage/session'

const vcf = (clnsig: string[]): string =>
  [
    '##fileformat=VCFv4.2',
    '##INFO=<ID=CLNSIG,Number=.,Type=String,Description="ClinVar significance">',
    '##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">',
    '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tHG005',
    ...clnsig.map((value, i) => `chr1\t${100 + i}\t.\tA\tG\t99\tPASS\tCLNSIG=${value}\tGT\t0/1`)
  ].join('\n') + '\n'

describe('unrecognised ClinVar values: SQLite main-thread paths', () => {
  let tmpDir: string
  let svc: DatabaseService

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'varlens-unranked-clinvar-'))
    svc = new DatabaseService(join(tmpDir, 'varlens.db'))
    await new Promise<void>((resolve) => setImmediate(resolve))
  })

  afterEach(() => {
    svc.close()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('the appended file of a multi-file import reports its unrecognised values', async () => {
    const filePath = join(tmpDir, 'append.vcf')
    writeFileSync(filePath, vcf(['Pathogenic', 'totally_made_up_term', 'totally_made_up_term']))
    const caseId = svc.cases.createCase('append-case', filePath, 1000)
    svc.variants.beginBulkInsert()

    const result = await importAdditionalFileToCase(
      caseId,
      filePath,
      { selectedSample: 'HG005' },
      () => svc,
      {}
    )

    expect(result.variantCount).toBe(3)
    expect(result.unrankedClinvar).toEqual(['totally_made_up_term'])
  })

  it('an appended file with only known values reports none', async () => {
    const filePath = join(tmpDir, 'known.vcf')
    writeFileSync(filePath, vcf(['Pathogenic', 'Likely_benign']))
    const caseId = svc.cases.createCase('known-case', filePath, 1000)
    svc.variants.beginBulkInsert()

    const result = await importAdditionalFileToCase(
      caseId,
      filePath,
      { selectedSample: 'HG005' },
      () => svc,
      {}
    )

    expect(result.variantCount).toBe(2)
    expect(result.unrankedClinvar).toBeUndefined()
  })

  it('ImportService reports the unrecognised values of a main-thread import', async () => {
    const filePath = join(tmpDir, 'service.json')
    const variant = (pos: number, clinvar: string): Record<string, unknown> => ({
      chr: 'chr1',
      pos,
      ref: 'A',
      alt: 'G',
      gene_symbol: 'GENEA',
      gt_num: '0/1',
      func: 'missense_variant',
      consequence: 'HIGH',
      clinvar
    })
    writeFileSync(
      filePath,
      JSON.stringify({
        variants: [variant(100, 'Pathogenic'), variant(200, 'totally_made_up_term')]
      })
    )

    const result = await new ImportService(svc).importVariants(filePath, {
      caseName: 'service-case'
    })

    expect(result.variantCount).toBe(2)
    expect(result.unrankedClinvar).toEqual(['totally_made_up_term'])
  })
})

describe('mergeUnrankedClinvar', () => {
  it('keeps each value once, in first-seen order, and is undefined when empty', () => {
    expect(mergeUnrankedClinvar([['b', 'a'], undefined, ['a', 'c']])).toEqual(['b', 'a', 'c'])
    expect(mergeUnrankedClinvar([undefined, []])).toBeUndefined()
  })
})

describe('startMultiFileImport on PostgreSQL', () => {
  const files = [{ filePath: '/x/a.vcf', variantType: 'snv', caller: null, annotationFormat: null }]
  const run = (unrankedClinvar?: string[]) => {
    const session = {
      capabilities: { backend: 'postgres' },
      getImportExecutor: () => ({
        cancel: vi.fn(),
        importMultiFile: vi.fn(async () => ({
          caseId: 7,
          variantCount: 3,
          files: [{ filePath: '/x/a.vcf', variantType: 'snv', variantCount: 3 }],
          skipped: 0,
          errors: [],
          elapsed: 5,
          ...(unrankedClinvar !== undefined ? { unrankedClinvar } : {})
        }))
      })
    } as unknown as StorageSession
    return startMultiFileImport(
      'pg-case',
      files as never,
      undefined,
      () => session,
      () => {
        throw new Error('no SQLite database')
      },
      {}
    )
  }

  it('carries the unrecognised values of the worker into the result', async () => {
    const result = await run(['totally_made_up_term'])
    expect(result).toMatchObject({ caseId: 7, totalVariants: 3 })
    expect(result.unrankedClinvar).toEqual(['totally_made_up_term'])
  })

  it('leaves the field out when every value was recognised', async () => {
    expect('unrankedClinvar' in (await run())).toBe(false)
  })
})

describe('runSessionBatchImport', () => {
  it('puts the unrecognised values of a file into its detail and its completion event', async () => {
    const importSingleFile = vi.fn(async (params: { caseName: string }) => ({
      caseId: 100,
      variantCount: 3,
      skipped: 0,
      errors: [],
      elapsed: 1,
      ...(params.caseName === 'odd' ? { unrankedClinvar: ['totally_made_up_term'] } : {})
    }))
    const session = {
      capabilities: { backend: 'postgres' },
      listCases: vi.fn(async () => []),
      getWriteExecutor: () => ({ execute: vi.fn(async () => undefined) }),
      getImportExecutor: () => ({ importSingleFile, cancel: vi.fn() })
    } as unknown as StorageSession
    const completed: Array<{ caseName?: string; unrankedClinvar?: string[] }> = []

    const result = await runSessionBatchImport({
      files: ['odd', 'plain'].map((name) => ({
        inputPath: `ref:${name}.json`,
        storedPath: `/stage/${name}.json`,
        fileName: `${name}.json`
      })),
      duplicateStrategy: 'skip',
      session,
      callbacks: { onFileComplete: (event) => completed.push(event) },
      signal: new AbortController().signal
    })

    expect(result.details.map((d) => [d.caseName, d.unrankedClinvar])).toEqual([
      ['odd', ['totally_made_up_term']],
      ['plain', undefined]
    ])
    expect(completed.map((e) => [e.caseName, e.unrankedClinvar])).toEqual([
      ['odd', ['totally_made_up_term']],
      ['plain', undefined]
    ])
  })
})
