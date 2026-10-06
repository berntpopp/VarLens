/**
 * Heap limit for the SQLite and PostgreSQL import worker threads.
 *
 * With an explicit `resourceLimits`, a worker that exhausts its heap is
 * terminated on its own with `ERR_WORKER_OUT_OF_MEMORY`, at a bound chosen
 * for this machine rather than V8's process-wide default, and the client
 * turns that into an import failure the user can read (issue #445).
 */
import { totalmem } from 'node:os'
import type { ResourceLimits } from 'node:worker_threads'

const MIB = 1024 * 1024

/**
 * Floor: one maximal 64 MiB VCF line plus a full 64 MiB batch, with the
 * several-fold overhead of parsed JS objects, stays below this.
 */
export const IMPORT_WORKER_HEAP_FLOOR_MB = 1024
/**
 * Ceiling: import memory does not grow with file size, so more only delays
 * the failure of a runaway import. It also stays inside the 4 GiB heap that
 * Electron's V8 pointer compression allows per isolate.
 */
export const IMPORT_WORKER_HEAP_CEILING_MB = 3072
/** Share of physical memory one import worker may use for its old generation. */
const IMPORT_WORKER_HEAP_FRACTION = 0.25

export function importWorkerHeapLimitMb(totalMemoryBytes: number = totalmem()): number {
  const share = Math.floor((totalMemoryBytes * IMPORT_WORKER_HEAP_FRACTION) / MIB)
  return Math.min(IMPORT_WORKER_HEAP_CEILING_MB, Math.max(IMPORT_WORKER_HEAP_FLOOR_MB, share))
}

export function importWorkerResourceLimits(totalMemoryBytes?: number): ResourceLimits {
  return { maxOldGenerationSizeMb: importWorkerHeapLimitMb(totalMemoryBytes) }
}
