// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  IMPORT_WORKER_HEAP_CEILING_MB,
  IMPORT_WORKER_HEAP_FLOOR_MB,
  importWorkerHeapLimitMb,
  importWorkerResourceLimits
} from '../../../src/main/workers/import-worker-limits'
import {
  ImportResourceLimitError,
  classifyWorkerError,
  describeWorkerCrash,
  workerErrorToError
} from '../../../src/main/storage/import-worker-errors'
import { ErrorCode } from '../../../src/shared/types/errors'

const GIB = 1024 ** 3

describe('importWorkerHeapLimitMb', () => {
  it('uses a quarter of physical memory between the floor and the ceiling', () => {
    expect(importWorkerHeapLimitMb(8 * GIB)).toBe(2048)
  })

  it('never goes below the floor on a small machine', () => {
    expect(importWorkerHeapLimitMb(2 * GIB)).toBe(IMPORT_WORKER_HEAP_FLOOR_MB)
    expect(importWorkerHeapLimitMb(0)).toBe(IMPORT_WORKER_HEAP_FLOOR_MB)
  })

  it('never goes above the ceiling on a large machine', () => {
    expect(importWorkerHeapLimitMb(64 * GIB)).toBe(IMPORT_WORKER_HEAP_CEILING_MB)
    expect(importWorkerHeapLimitMb(1024 * GIB)).toBe(IMPORT_WORKER_HEAP_CEILING_MB)
  })

  it('is what the worker resource limits carry', () => {
    expect(importWorkerResourceLimits(8 * GIB)).toEqual({ maxOldGenerationSizeMb: 2048 })
  })
})

describe('worker crash classification', () => {
  const oom = Object.assign(new Error('JS heap out of memory'), {
    code: 'ERR_WORKER_OUT_OF_MEMORY'
  })

  it('describes ERR_WORKER_OUT_OF_MEMORY as RESOURCE_LIMIT with a user message', () => {
    const fields = describeWorkerCrash(oom)
    expect(fields.code).toBe(ErrorCode.RESOURCE_LIMIT)
    expect(fields.message).toBe('Import exceeded its memory budget: JS heap out of memory')
    expect(fields.userMessage).toMatch(/ran out of memory/)
  })

  it('leaves other worker errors as plain messages', () => {
    expect(describeWorkerCrash(new Error('boom'))).toEqual({ message: 'boom' })
  })

  it('rebuilds the typed error on the main side of the thread hop', () => {
    const rebuilt = workerErrorToError(describeWorkerCrash(oom))
    expect(rebuilt).toBeInstanceOf(ImportResourceLimitError)
    expect(classifyWorkerError(rebuilt).code).toBe(ErrorCode.RESOURCE_LIMIT)
  })
})
