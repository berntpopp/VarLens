/**
 * How many files of one batch import are loaded at the same time.
 *
 * Each concurrent file costs one parser thread, one dedicated database
 * connection and up to one import-worker heap (see import-worker-limits.ts),
 * so the number is deliberately small. `VARLENS_IMPORT_CONCURRENCY=1` restores
 * the strictly sequential batch loop.
 */
import { availableParallelism } from 'node:os'

export const IMPORT_CONCURRENCY_ENV = 'VARLENS_IMPORT_CONCURRENCY'
const MAX_IMPORT_CONCURRENCY = 8
const DEFAULT_IMPORT_CONCURRENCY_CAP = 4

export function resolveImportConcurrency(
  raw: string | undefined = process.env[IMPORT_CONCURRENCY_ENV],
  cores: number = availableParallelism()
): number {
  const fallback = Math.max(1, Math.min(DEFAULT_IMPORT_CONCURRENCY_CAP, Math.floor(cores / 2)))
  if (raw === undefined || raw.trim() === '') return fallback
  const parsed = Number(raw)
  if (!Number.isInteger(parsed)) return fallback
  return Math.max(1, Math.min(MAX_IMPORT_CONCURRENCY, parsed))
}
