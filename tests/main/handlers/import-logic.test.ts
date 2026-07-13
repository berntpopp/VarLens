/**
 * Import logic routing tests.
 *
 * Phase 9 routes both `startImport` (single-file, any format including VCF)
 * and `startMultiFileImport` (multi-file) through the active storage
 * session's `StorageImportExecutor` for PostgreSQL. SQLite continues through
 * the existing append pipeline. These tests pin the routing and cancellation
 * behavior without invoking the real worker pipeline.
 */

import { describe, expect, it, vi } from 'vitest'

import {
  startImport,
  cancelImport,
  startMultiFileImport
} from '../../../src/main/ipc/handlers/import-logic'

describe('import-logic exports', () => {
  it('exports expected functions', async () => {
    const logic = await import('../../../src/main/ipc/handlers/import-logic')
    expect(typeof logic.startImport).toBe('function')
    expect(typeof logic.cancelImport).toBe('function')
    expect(typeof logic.startMultiFileImport).toBe('function')
    expect(typeof logic.getVcfPreview).toBe('function')
  })
})

describe('startImport', () => {
  it('uses the active storage session import executor', async () => {
    const importSingleFile = vi.fn(async () => ({
      caseId: 4,
      variantCount: 3,
      skipped: 0,
      errors: [],
      elapsed: 10
    }))
    const executor = { importSingleFile, cancel: vi.fn() }
    const session = { getImportExecutor: () => executor }
    const getSession = (): never => session as never

    await expect(
      startImport('/tmp/input.json', 'Imported', undefined, getSession, {})
    ).resolves.toStrictEqual({
      caseId: 4,
      variantCount: 3,
      skipped: 0,
      errors: [],
      elapsed: 10
    })

    expect(importSingleFile).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: '/tmp/input.json',
        caseName: 'Imported'
      })
    )
  })

  it('forwards onProgress callback to the executor', async () => {
    const onProgress = vi.fn()
    const importSingleFile = vi.fn(async (params: { onProgress?: (data: unknown) => void }) => {
      params.onProgress?.({ phase: 'parsing', count: 0, elapsed: 0, skipped: 0 })
      return { caseId: 1, variantCount: 0, skipped: 0, errors: [], elapsed: 0 }
    })
    const session = { getImportExecutor: () => ({ importSingleFile, cancel: vi.fn() }) }
    await startImport('/tmp/x.json', 'n', undefined, () => session as never, { onProgress })
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'parsing' }))
  })

  it('forwards throttleMs using API_CONFIG.PROGRESS_THROTTLE_MS', async () => {
    const importSingleFile = vi.fn(async () => ({
      caseId: 2,
      variantCount: 1,
      skipped: 0,
      errors: [],
      elapsed: 0
    }))
    const session = { getImportExecutor: () => ({ importSingleFile, cancel: vi.fn() }) }
    await startImport('/tmp/x.json', 'n', undefined, () => session as never, {})
    expect(importSingleFile).toHaveBeenCalledWith(
      expect.objectContaining({
        throttleMs: expect.any(Number)
      })
    )
  })

  it('forwards vcfOptions to the executor', async () => {
    const importSingleFile = vi.fn(async () => ({
      caseId: 1,
      variantCount: 0,
      skipped: 0,
      errors: [],
      elapsed: 0
    }))
    const session = { getImportExecutor: () => ({ importSingleFile, cancel: vi.fn() }) }
    await startImport(
      '/tmp/x.vcf',
      'n',
      { selectedSample: 'HG002', genomeBuild: 'GRCh38' },
      () => session as never,
      {}
    )
    expect(importSingleFile).toHaveBeenCalledWith(
      expect.objectContaining({
        vcfOptions: { selectedSample: 'HG002', genomeBuild: 'GRCh38' }
      })
    )
  })

  it('cancelImport cancels the active storage import executor', async () => {
    const cancel = vi.fn()
    let resolveStart!: (v: unknown) => void
    const importSingleFile = vi.fn(
      () =>
        new Promise((r) => {
          resolveStart = r
        })
    )
    const session = { getImportExecutor: () => ({ importSingleFile, cancel }) }
    const promise = startImport('/tmp/x.json', 'n', undefined, () => session as never, {})
    cancelImport()
    expect(cancel).toHaveBeenCalled()
    resolveStart({
      caseId: 0,
      variantCount: 0,
      skipped: 0,
      errors: ['Import cancelled by user'],
      elapsed: 0
    })
    await promise
  })

  it('clears the active executor reference after completion', async () => {
    const cancel = vi.fn()
    const importSingleFile = vi.fn(async () => ({
      caseId: 1,
      variantCount: 1,
      skipped: 0,
      errors: [],
      elapsed: 0
    }))
    const session = { getImportExecutor: () => ({ importSingleFile, cancel }) }
    await startImport('/tmp/x.json', 'n', undefined, () => session as never, {})
    // After a completed import, cancelImport should not invoke the stale executor.
    cancelImport()
    expect(cancel).not.toHaveBeenCalled()
  })
})

describe('import-logic VCF + multi-file routing', () => {
  it('routes a VCF import:start through the session importSingleFile executor on PG', async () => {
    const importSingleFile = vi.fn(async () => ({
      caseId: 5,
      variantCount: 10,
      skipped: 0,
      errors: [],
      elapsed: 1
    }))
    const fakeExecutor = { importSingleFile, importMultiFile: vi.fn(), cancel: vi.fn() }
    const session = {
      capabilities: { backend: 'postgres' },
      getImportExecutor: () => fakeExecutor
    }
    const result = await startImport(
      '/tmp/a.vcf.gz',
      'X',
      { selectedSample: 'NA12878', genomeBuild: 'GRCh38' },
      () => session as never,
      {}
    )
    expect(importSingleFile).toHaveBeenCalledTimes(1)
    expect(importSingleFile.mock.calls[0][0].filePath).toBe('/tmp/a.vcf.gz')
    expect(result.variantCount).toBe(10)
  })

  it('routes import:startMultiFile through importMultiFile executor on PG', async () => {
    const importMultiFile = vi.fn(async () => ({
      caseId: 6,
      variantCount: 20,
      files: [{ filePath: '/abs/a.vcf', variantType: 'snv-indel', variantCount: 20 }],
      skipped: 0,
      errors: [],
      elapsed: 2
    }))
    const fakeExecutor = { importSingleFile: vi.fn(), importMultiFile, cancel: vi.fn() }
    const session = {
      capabilities: { backend: 'postgres' },
      getImportExecutor: () => fakeExecutor
    }
    const result = await startMultiFileImport(
      'Multi case',
      [{ filePath: '/abs/a.vcf', variantType: 'snv-indel', caller: null, annotationFormat: null }],
      { selectedSample: 'NA12878', genomeBuild: 'GRCh38' },
      () => session as never,
      (() => ({})) as never,
      {}
    )
    expect(importMultiFile).toHaveBeenCalledTimes(1)
    const args = importMultiFile.mock.calls[0][0]
    expect(args.caseName).toBe('Multi case')
    expect(args.files).toHaveLength(1)
    expect(result.totalVariants).toBe(20)
  })

  it('keeps PostgreSQL multi-file cancellation reachable for the full operation', async () => {
    const cancel = vi.fn()
    let resolveImport!: (result: unknown) => void
    const importMultiFile = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveImport = resolve
        })
    )
    const executor = { importSingleFile: vi.fn(), importMultiFile, cancel }
    const session = {
      capabilities: { backend: 'postgres' },
      getImportExecutor: () => executor
    }

    const pending = startMultiFileImport(
      'Multi case',
      [{ filePath: '/abs/a.vcf', variantType: 'snv-indel', caller: null, annotationFormat: null }],
      undefined,
      () => session as never,
      (() => ({})) as never,
      {}
    )
    await expect(
      startImport('/abs/second.vcf', 'Second', undefined, () => session as never, {})
    ).rejects.toThrow(/already in progress/i)
    cancelImport()

    expect(cancel).toHaveBeenCalledOnce()
    resolveImport({
      caseId: 0,
      variantCount: 0,
      files: [],
      skipped: 0,
      errors: ['Import cancelled by user'],
      elapsed: 1
    })
    await pending
  })

  it('translates ImportFiltersPayload (bedFile) to StorageImportFileFilters (bedFilePath) on PG path', async () => {
    const importMultiFile = vi.fn(async () => ({
      caseId: 7,
      variantCount: 0,
      files: [],
      skipped: 0,
      errors: [],
      elapsed: 0
    }))
    const fakeExecutor = { importSingleFile: vi.fn(), importMultiFile, cancel: vi.fn() }
    const session = {
      capabilities: { backend: 'postgres' },
      getImportExecutor: () => fakeExecutor
    }
    await startMultiFileImport(
      'X',
      [{ filePath: '/abs/a.vcf', variantType: 'snv-indel', caller: null, annotationFormat: null }],
      { selectedSample: 'NA12878', genomeBuild: 'GRCh38' },
      () => session as never,
      (() => ({})) as never,
      {},
      undefined,
      { bedFile: '/abs/regions.bed', bedPadding: 50, passOnly: true }
    )
    const args = importMultiFile.mock.calls[0][0]
    expect(args.filters?.bedFilePath).toBe('/abs/regions.bed')
    expect(args.filters?.bedPadding).toBe(50)
    expect(args.filters?.passOnly).toBe(true)
  })

  it('does not call importMultiFile executor on the SQLite path', async () => {
    // On the SQLite path the dispatcher delegates to startMultiFileImportSqlite,
    // which will eventually call startImport (the first-file worker path).
    // We verify: (1) importMultiFile is never called, (2) the function does
    // NOT throw the old Phase-8 "not supported" error, (3) importSingleFile
    // IS called (the SQLite pipeline creates the case via startImport).
    const importSingleFile = vi.fn(async () => ({
      caseId: 1,
      variantCount: 5,
      skipped: 0,
      errors: [],
      elapsed: 0
    }))
    const importMultiFile = vi.fn()
    const fakeExecutor = { importSingleFile, importMultiFile, cancel: vi.fn() }
    // Minimal db mock — just enough for the SQLite path to record provenance
    // and finish the single-file case (no additional files to append).
    const fakeDb = {
      cases: {
        insertImportFile: vi.fn(),
        getCase: vi.fn(() => ({ genome_build: 'GRCh38' }))
      },
      variants: {
        recalculateCaseVariantCount: vi.fn()
      }
    }
    const session = {
      capabilities: { backend: 'sqlite' },
      getImportExecutor: () => fakeExecutor
    }
    const result = await startMultiFileImport(
      'SQLite case',
      [{ filePath: '/abs/b.vcf', variantType: 'snv-indel', caller: null, annotationFormat: null }],
      undefined,
      () => session as never,
      () => fakeDb as never,
      {}
    )
    // PG executor must NOT have been used
    expect(importMultiFile).not.toHaveBeenCalled()
    // SQLite path calls startImport → importSingleFile
    expect(importSingleFile).toHaveBeenCalledTimes(1)
    expect(result.caseId).toBe(1)
    expect(result.totalVariants).toBe(5)
  })
})
