import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import type {
  StorageImportExecutor,
  StorageImportSingleFileParams,
  StorageImportSingleFileResult,
  StorageImportMultiFileParams,
  StorageImportMultiFileResult,
  StorageImportFileFilters,
  ImportFileCompleteEvent
} from '../../../src/main/storage/import-executor'

describe('StorageImportExecutor contract', () => {
  it('defines single-file import params and result shape', async () => {
    const params = {
      filePath: '/tmp/import.json',
      caseName: 'PG JSON import',
      vcfOptions: { genomeBuild: 'GRCh38' },
      throttleMs: 100,
      onProgress: vi.fn()
    } satisfies StorageImportSingleFileParams

    const executor: StorageImportExecutor = {
      importSingleFile: vi.fn(async () => ({
        caseId: 4,
        variantCount: 3,
        skipped: 0,
        errors: [],
        elapsed: 12
      })),
      importMultiFile: vi.fn(),
      cancel: vi.fn()
    }

    await expect(executor.importSingleFile(params)).resolves.toStrictEqual({
      caseId: 4,
      variantCount: 3,
      skipped: 0,
      errors: [],
      elapsed: 12
    })
    expectTypeOf<StorageImportSingleFileResult>().toMatchTypeOf<{
      caseId: number
      variantCount: number
      skipped: number
      errors: string[]
      elapsed: number
    }>()
  })
})

describe('StorageImportExecutor.importMultiFile contract', () => {
  it('defines params, filters, and result shapes', async () => {
    const filters: StorageImportFileFilters = {
      bedFilePath: '/abs/regions.bed',
      bedPadding: 0,
      passOnly: true,
      minQual: 30,
      minGq: 20,
      minDp: 10
    }

    const params: StorageImportMultiFileParams = {
      caseName: 'Multi-file case',
      files: [
        {
          filePath: '/abs/a.vcf.gz',
          variantType: 'snv-indel',
          annotationFormat: null,
          caller: null
        },
        {
          filePath: '/abs/b.vcf.gz',
          variantType: 'snv-indel',
          annotationFormat: null,
          caller: null
        }
      ],
      vcfOptions: { selectedSample: 'NA12878', genomeBuild: 'GRCh38' },
      filters,
      throttleMs: 100
    }

    const executor: StorageImportExecutor = {
      importSingleFile: vi.fn(),
      importMultiFile: vi.fn(async (): Promise<StorageImportMultiFileResult> => ({
        caseId: 7,
        variantCount: 1234,
        files: [
          { filePath: '/abs/a.vcf.gz', variantType: 'snv-indel', variantCount: 800 },
          { filePath: '/abs/b.vcf.gz', variantType: 'snv-indel', variantCount: 434 }
        ],
        skipped: 0,
        errors: [],
        elapsed: 250
      })),
      cancel: vi.fn()
    }

    const result: StorageImportMultiFileResult = await executor.importMultiFile(params)
    expect(result.caseId).toBe(7)
    expect(result.files).toHaveLength(2)
    expect(result.files[0].variantCount).toBe(800)

    expectTypeOf<StorageImportMultiFileResult>().toMatchTypeOf<{
      caseId: number
      variantCount: number
      files: Array<{
        filePath: string
        variantType: string
        variantCount: number
        error?: string
      }>
      skipped: number
      errors: string[]
      elapsed: number
    }>()
  })

  it('ImportFileCompleteEvent has filePath, caseId, variantCount fields', () => {
    expectTypeOf<ImportFileCompleteEvent>().toEqualTypeOf<{
      filePath: string
      caseId: number
      variantCount: number
    }>()
  })
})
