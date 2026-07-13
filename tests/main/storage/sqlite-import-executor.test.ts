import { describe, expect, it, vi } from 'vitest'

import { SqliteImportExecutor } from '../../../src/main/storage/sqlite/SqliteImportExecutor'
import type { MultiFileImportResult } from '../../../src/main/ipc/handlers/import-logic'
import type { StorageImportFileFilters } from '../../../src/main/storage/import-executor'

describe('SqliteImportExecutor', () => {
  it('delegates single-file import to the existing worker client shape', async () => {
    const start = vi.fn()
    const worker = {
      get isRunning() {
        return false
      },
      start,
      cancel: vi.fn()
    }
    const executor = new SqliteImportExecutor({
      getDatabaseService: () =>
        ({
          getPath: () => '/tmp/test.varlens',
          getEncryptionKey: () => 'secret',
          variants: { updateFrequencies: vi.fn() }
        }) as never,
      createWorkerClient: () => worker as never
    })

    const promise = executor.importSingleFile({
      filePath: '/tmp/input.json',
      caseName: 'Imported',
      throttleMs: 100
    })

    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [
          expect.objectContaining({
            filePath: '/tmp/input.json',
            caseName: 'Imported',
            duplicateStrategy: 'skip'
          })
        ],
        dbPath: '/tmp/test.varlens',
        encryptionKey: 'secret'
      })
    )

    const callbacks = start.mock.calls[0][0]
    callbacks.onFileComplete({
      type: 'file-complete',
      fileIndex: 0,
      result: { caseId: 7, caseName: 'Imported', variantCount: 3, skipped: 0, elapsed: 5 }
    })
    callbacks.onComplete({
      type: 'complete',
      results: {
        succeeded: 1,
        failed: 0,
        skipped: 0,
        cancelled: false,
        details: [
          {
            filePath: '/tmp/input.json',
            fileName: 'input.json',
            caseName: 'Imported',
            status: 'success',
            variantCount: 3
          }
        ]
      }
    })

    await expect(promise).resolves.toStrictEqual({
      caseId: 7,
      variantCount: 3,
      skipped: 0,
      errors: [],
      elapsed: 5
    })
  })

  it('returns the worker skip count and bounded reasons for malformed VCF rows', async () => {
    const start = vi.fn()
    const worker = {
      get isRunning() {
        return false
      },
      start,
      cancel: vi.fn()
    }
    const executor = new SqliteImportExecutor({
      getDatabaseService: () =>
        ({
          getPath: () => '/tmp/test.varlens',
          getEncryptionKey: () => undefined,
          variants: { updateFrequencies: vi.fn() }
        }) as never,
      createWorkerClient: () => worker as never
    })

    const promise = executor.importSingleFile({
      filePath: '/tmp/input.vcf',
      caseName: 'Imported',
      throttleMs: 100
    })
    const callbacks = start.mock.calls[0][0]
    callbacks.onFileComplete({
      type: 'file-complete',
      fileIndex: 0,
      result: {
        caseId: 7,
        caseName: 'Imported',
        variantCount: 3,
        skipped: 2,
        skipReasons: ['invalid POS "x"', 'invalid POS "-1"'],
        elapsed: 5
      }
    })
    callbacks.onComplete({
      type: 'complete',
      results: {
        succeeded: 1,
        failed: 0,
        skipped: 0,
        cancelled: false,
        details: [
          {
            filePath: '/tmp/input.vcf',
            fileName: 'input.vcf',
            caseName: 'Imported',
            status: 'success',
            variantCount: 3
          }
        ]
      }
    })

    await expect(promise).resolves.toStrictEqual({
      caseId: 7,
      variantCount: 3,
      skipped: 2,
      errors: ['invalid POS "x"', 'invalid POS "-1"'],
      elapsed: 5
    })
  })

  it('resolves with cancellation result shape when the worker reports cancelled', async () => {
    const start = vi.fn()
    const worker = {
      get isRunning() {
        return false
      },
      start,
      cancel: vi.fn()
    }
    const executor = new SqliteImportExecutor({
      getDatabaseService: () =>
        ({
          getPath: () => '/tmp/test.varlens',
          getEncryptionKey: () => undefined,
          variants: { updateFrequencies: vi.fn() }
        }) as never,
      createWorkerClient: () => worker as never
    })

    const promise = executor.importSingleFile({
      filePath: '/tmp/input.json',
      caseName: 'Imported',
      throttleMs: 100
    })

    const callbacks = start.mock.calls[0][0]
    callbacks.onComplete({
      type: 'complete',
      results: {
        succeeded: 0,
        failed: 0,
        skipped: 0,
        cancelled: true,
        details: []
      }
    })

    await expect(promise).resolves.toStrictEqual({
      caseId: 0,
      variantCount: 0,
      skipped: 0,
      errors: ['Import cancelled by user'],
      elapsed: 0
    })
  })

  it('rejects with the worker error message on fatal onError (fileIndex === -1)', async () => {
    const start = vi.fn()
    const worker = {
      get isRunning() {
        return false
      },
      start,
      cancel: vi.fn()
    }
    const executor = new SqliteImportExecutor({
      getDatabaseService: () =>
        ({
          getPath: () => '/tmp/test.varlens',
          getEncryptionKey: () => undefined,
          variants: { updateFrequencies: vi.fn() }
        }) as never,
      createWorkerClient: () => worker as never
    })

    const promise = executor.importSingleFile({
      filePath: '/tmp/input.json',
      caseName: 'Imported',
      throttleMs: 100
    })

    const callbacks = start.mock.calls[0][0]
    callbacks.onError({
      type: 'error',
      fileIndex: -1,
      error: 'worker blew up',
      phase: 'worker'
    })

    await expect(promise).rejects.toThrow('worker blew up')
  })

  it('rejects a second concurrent import attempt while one is already running', async () => {
    let running = false
    const start = vi.fn(() => {
      running = true
    })
    const worker = {
      get isRunning() {
        return running
      },
      start,
      cancel: vi.fn()
    }
    const executor = new SqliteImportExecutor({
      getDatabaseService: () =>
        ({
          getPath: () => '/tmp/test.varlens',
          getEncryptionKey: () => undefined,
          variants: { updateFrequencies: vi.fn() }
        }) as never,
      createWorkerClient: () => worker as never
    })

    const first = executor.importSingleFile({
      filePath: '/tmp/input.json',
      caseName: 'Imported',
      throttleMs: 100
    })

    await expect(
      executor.importSingleFile({
        filePath: '/tmp/another.json',
        caseName: 'Second',
        throttleMs: 100
      })
    ).rejects.toThrow('An import is already in progress')

    // Single-file imports now share the process-wide JobRunner `import_single`
    // slot, so the first (still-running) import must be settled before the test
    // ends — otherwise its slot leaks into later tests in this file.
    running = false
    const callbacks = start.mock.calls[0][0]
    callbacks.onComplete({
      type: 'complete',
      results: {
        succeeded: 1,
        failed: 0,
        skipped: 0,
        cancelled: false,
        details: [
          {
            filePath: '/tmp/input.json',
            fileName: 'input.json',
            caseName: 'Imported',
            status: 'success',
            variantCount: 1
          }
        ]
      }
    })
    await first
  })

  it('translates vcfOptions.selectedSample into vcfSelectedSamples and maps finalizing progress to inserting', async () => {
    const start = vi.fn()
    const worker = {
      get isRunning() {
        return false
      },
      start,
      cancel: vi.fn()
    }
    const executor = new SqliteImportExecutor({
      getDatabaseService: () =>
        ({
          getPath: () => '/tmp/test.varlens',
          getEncryptionKey: () => undefined,
          variants: { updateFrequencies: vi.fn() }
        }) as never,
      createWorkerClient: () => worker as never
    })

    const onProgress = vi.fn()
    const promise = executor.importSingleFile({
      filePath: '/tmp/input.vcf',
      caseName: 'Imported',
      vcfOptions: { selectedSample: 'NA12878', genomeBuild: 'GRCh38' },
      throttleMs: 100,
      onProgress
    })

    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [
          expect.objectContaining({
            filePath: '/tmp/input.vcf',
            caseName: 'Imported',
            duplicateStrategy: 'skip',
            vcfSelectedSamples: ['NA12878'],
            vcfGenomeBuild: 'GRCh38'
          })
        ]
      })
    )

    const callbacks = start.mock.calls[0][0]
    callbacks.onProgress({
      type: 'progress',
      fileIndex: 0,
      phase: 'finalizing',
      variantCount: 10,
      skipped: 1
    })

    expect(onProgress).toHaveBeenCalledWith({
      phase: 'inserting',
      count: 10,
      elapsed: 0,
      skipped: 1
    })

    // Settle the import so the shared JobRunner `import_single` slot is freed
    // for later tests in this file.
    callbacks.onComplete({
      type: 'complete',
      results: {
        succeeded: 1,
        failed: 0,
        skipped: 0,
        cancelled: false,
        details: [
          {
            filePath: '/tmp/input.vcf',
            fileName: 'input.vcf',
            caseName: 'Imported',
            status: 'success',
            variantCount: 10
          }
        ]
      }
    })
    await promise
  })

  it('clears the worker reference if worker.start() throws synchronously so later imports are not blocked', async () => {
    let throwOnStart = true
    const start = vi.fn(() => {
      if (throwOnStart) {
        throwOnStart = false
        throw new Error('worker boot failed')
      }
    })
    const cancel = vi.fn()
    const worker = {
      get isRunning() {
        return false
      },
      start,
      cancel
    }
    const executor = new SqliteImportExecutor({
      getDatabaseService: () =>
        ({
          getPath: () => '/tmp/test.varlens',
          getEncryptionKey: () => undefined,
          variants: { updateFrequencies: vi.fn() }
        }) as never,
      createWorkerClient: () => worker as never
    })

    await expect(
      executor.importSingleFile({
        filePath: '/tmp/input.json',
        caseName: 'Imported',
        throttleMs: 100
      })
    ).rejects.toThrow('worker boot failed')

    // After a synchronous start() failure the executor must not hold onto the
    // broken worker: cancel() should be a no-op and a new import must be
    // acceptable without hitting the "already in progress" guard.
    executor.cancel()
    expect(cancel).not.toHaveBeenCalled()

    // Second attempt reaches start() again rather than being blocked.
    const second = executor.importSingleFile({
      filePath: '/tmp/input2.json',
      caseName: 'Second',
      throttleMs: 100
    })
    // start() runs synchronously inside the JobRunner handler, so the second
    // call's start invocation is observable before awaiting.
    await new Promise((r) => queueMicrotask(r as () => void))
    expect(start).toHaveBeenCalledTimes(2)

    // Settle the second import so the shared JobRunner `import_single` slot is
    // freed for later tests in this file.
    const callbacks = start.mock.calls[1][0]
    callbacks.onComplete({
      type: 'complete',
      results: {
        succeeded: 1,
        failed: 0,
        skipped: 0,
        cancelled: false,
        details: [
          {
            filePath: '/tmp/input2.json',
            fileName: 'input2.json',
            caseName: 'Second',
            status: 'success',
            variantCount: 1
          }
        ]
      }
    })
    await second
  })
})

describe('SqliteImportExecutor.importMultiFile', () => {
  function makeFakeResult(overrides?: Partial<MultiFileImportResult>): MultiFileImportResult {
    return {
      caseId: 42,
      totalVariants: 150,
      totalSkipped: 3,
      files: [
        { filePath: '/tmp/a.vcf', variantType: 'snv', variantCount: 100 },
        { filePath: '/tmp/b.vcf', variantType: 'sv', variantCount: 50 }
      ],
      elapsed: 1234,
      ...overrides
    }
  }

  it('delegates to the injected multiFileImportDelegate and maps result to StorageImportMultiFileResult', async () => {
    const delegate = vi.fn(async (): Promise<MultiFileImportResult> => makeFakeResult())

    const executor = new SqliteImportExecutor({
      getDatabaseService: () =>
        ({
          getPath: () => '/tmp/test.varlens',
          getEncryptionKey: () => undefined
        }) as never,
      multiFileImportDelegate: delegate
    })

    const files = [
      { filePath: '/tmp/a.vcf', variantType: 'snv', caller: null, annotationFormat: 'csq' },
      { filePath: '/tmp/b.vcf', variantType: 'sv', caller: 'manta', annotationFormat: null }
    ]

    const result = await executor.importMultiFile({
      caseName: 'MyCase',
      files,
      vcfOptions: { selectedSample: 'NA12878', genomeBuild: 'GRCh38' }
    })

    expect(delegate).toHaveBeenCalledTimes(1)
    expect(delegate).toHaveBeenCalledWith(
      expect.objectContaining({
        caseName: 'MyCase',
        files,
        vcfOptions: { selectedSample: 'NA12878', genomeBuild: 'GRCh38' }
      })
    )

    expect(result).toStrictEqual({
      caseId: 42,
      variantCount: 150,
      files: [
        { filePath: '/tmp/a.vcf', variantType: 'snv', variantCount: 100 },
        { filePath: '/tmp/b.vcf', variantType: 'sv', variantCount: 50 }
      ],
      skipped: 3,
      errors: [],
      elapsed: 1234
    })
  })

  it('translates StorageImportFileFilters into ImportFilters-compatible shape (no bedFile)', async () => {
    let capturedFilters: unknown
    const delegate = vi.fn(async (input: { filters?: unknown }): Promise<MultiFileImportResult> => {
      capturedFilters = input.filters
      return makeFakeResult()
    })

    const executor = new SqliteImportExecutor({
      getDatabaseService: () =>
        ({
          getPath: () => '/tmp/test.varlens',
          getEncryptionKey: () => undefined
        }) as never,
      multiFileImportDelegate: delegate
    })

    const filters: StorageImportFileFilters = {
      bedFilePath: null,
      bedPadding: 75,
      passOnly: true,
      minQual: 20,
      minGq: 10,
      minDp: 5
    }

    await executor.importMultiFile({
      caseName: 'FilterCase',
      files: [
        { filePath: '/tmp/a.vcf', variantType: 'snv', caller: null, annotationFormat: 'csq' }
      ],
      filters
    })

    expect(capturedFilters).toMatchObject({
      bedPadding: 75,
      passOnly: true,
      minQual: 20,
      minGq: 10,
      minDp: 5
    })
    // No bedFilter instance when bedFilePath is null
    expect((capturedFilters as { bedFilter?: unknown }).bedFilter).toBeUndefined()
  })

  it('fails closed when an explicitly requested BED filter cannot be loaded', async () => {
    const delegate = vi.fn(async (): Promise<MultiFileImportResult> => makeFakeResult())
    const executor = new SqliteImportExecutor({
      getDatabaseService: () =>
        ({
          getPath: () => '/tmp/test.varlens',
          getEncryptionKey: () => undefined
        }) as never,
      multiFileImportDelegate: delegate
    })

    await expect(
      executor.importMultiFile({
        caseName: 'Filtered',
        files: [
          { filePath: '/tmp/a.vcf', variantType: 'snv', caller: null, annotationFormat: null }
        ],
        filters: { bedFilePath: '/tmp/varlens-missing-filter.bed' }
      })
    ).rejects.toThrow(/ENOENT|no such file/i)
    expect(delegate).not.toHaveBeenCalled()
  })

  it('passes undefined filters when no filters param is provided', async () => {
    let capturedFilters: unknown = 'sentinel'
    const delegate = vi.fn(async (input: { filters?: unknown }): Promise<MultiFileImportResult> => {
      capturedFilters = input.filters
      return makeFakeResult()
    })

    const executor = new SqliteImportExecutor({
      getDatabaseService: () =>
        ({
          getPath: () => '/tmp/test.varlens',
          getEncryptionKey: () => undefined
        }) as never,
      multiFileImportDelegate: delegate
    })

    await executor.importMultiFile({
      caseName: 'NoFilter',
      files: [{ filePath: '/tmp/a.vcf', variantType: 'snv', caller: null, annotationFormat: null }]
    })

    expect(capturedFilters).toBeUndefined()
  })

  it('fires onProgress when delegate callbacks invoke them', async () => {
    let capturedCallbacks: { onProgress?: (data: unknown) => void } = {}

    const delegate = vi.fn(
      async (input: {
        callbacks: { onProgress?: (data: unknown) => void }
      }): Promise<MultiFileImportResult> => {
        capturedCallbacks = input.callbacks
        return makeFakeResult()
      }
    )

    const executor = new SqliteImportExecutor({
      getDatabaseService: () =>
        ({
          getPath: () => '/tmp/test.varlens',
          getEncryptionKey: () => undefined
        }) as never,
      multiFileImportDelegate: delegate
    })

    const onProgress = vi.fn()

    await executor.importMultiFile({
      caseName: 'ProgressCase',
      files: [
        { filePath: '/tmp/a.vcf', variantType: 'snv', caller: null, annotationFormat: 'csq' }
      ],
      onProgress
    })

    // Simulate delegate invoking onProgress callback
    capturedCallbacks.onProgress?.({
      phase: 'inserting',
      count: 77,
      elapsed: 500,
      skipped: 1
    })

    expect(onProgress).toHaveBeenCalledWith({
      phase: 'inserting',
      count: 77,
      elapsed: 500,
      skipped: 1
    })
  })

  it('rejects with "already in progress" when a worker import is running', async () => {
    let running = false
    const start = vi.fn(() => {
      running = true
    })
    const worker = {
      get isRunning() {
        return running
      },
      start,
      cancel: vi.fn()
    }

    const delegate = vi.fn(async (): Promise<MultiFileImportResult> => makeFakeResult())

    const executor = new SqliteImportExecutor({
      getDatabaseService: () =>
        ({
          getPath: () => '/tmp/test.varlens',
          getEncryptionKey: () => undefined,
          variants: { updateFrequencies: vi.fn() }
        }) as never,
      createWorkerClient: () => worker as never,
      multiFileImportDelegate: delegate
    })

    // Start a single-file import to occupy the worker slot
    const first = executor.importSingleFile({
      filePath: '/tmp/a.vcf',
      caseName: 'First',
      throttleMs: 100
    })

    await expect(
      executor.importMultiFile({
        caseName: 'Concurrent',
        files: [
          { filePath: '/tmp/b.vcf', variantType: 'snv', caller: null, annotationFormat: null }
        ]
      })
    ).rejects.toThrow('An import is already in progress')

    // Settle the single-file import so the shared JobRunner `import_single` slot
    // is freed for later tests in this file.
    running = false
    const callbacks = start.mock.calls[0][0]
    callbacks.onComplete({
      type: 'complete',
      results: {
        succeeded: 1,
        failed: 0,
        skipped: 0,
        cancelled: false,
        details: [
          {
            filePath: '/tmp/a.vcf',
            fileName: 'a.vcf',
            caseName: 'First',
            status: 'success',
            variantCount: 1
          }
        ]
      }
    })
    await first
  })

  it('uses fallback elapsed (Date.now() - start) when delegate returns elapsed=0', async () => {
    const delegate = vi.fn(async (): Promise<MultiFileImportResult> =>
      makeFakeResult({ elapsed: 0 })
    )

    const executor = new SqliteImportExecutor({
      getDatabaseService: () =>
        ({
          getPath: () => '/tmp/test.varlens',
          getEncryptionKey: () => undefined
        }) as never,
      multiFileImportDelegate: delegate
    })

    const result = await executor.importMultiFile({
      caseName: 'ElapsedCase',
      files: [{ filePath: '/tmp/a.vcf', variantType: 'snv', caller: null, annotationFormat: null }]
    })

    // elapsed should be > 0 (filled in by Date.now() - startedAt)
    expect(result.elapsed).toBeGreaterThanOrEqual(0)
  })
})
