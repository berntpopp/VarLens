/**
 * Composable owning the case-delete IPC calls and the cache hygiene that must
 * follow them.
 *
 * Deleting a case cascades its rows away in the database, but the renderer's
 * per-case caches (metadata, comments, metrics) would otherwise keep the
 * deleted id until the next database switch. Every delete here evicts once the
 * IPC call *settles*:
 *   - success → the case is gone, nothing may still hold its id;
 *   - failure → callers roll the case back into the list, so its entries are
 *     dropped and the next read reloads them instead of trusting state from
 *     before a delete that may have partially run.
 *
 * Eviction is never optimistic: callers remove the row from the UI first and
 * await (or chain on) these promises.
 */

import { unwrapIpcResult } from '../../../shared/types/errors'
import { useApiService } from './useApiService'
import { useCaseMetadata } from './useCaseMetadata'

export function useCaseDeletion() {
  const { api } = useApiService()
  const { invalidateCase, invalidateAllCases } = useCaseMetadata()

  function requireApi(): NonNullable<typeof api> {
    if (!api) throw new Error('Case deletion is unavailable: API not initialised')
    return api
  }

  async function deleteCase(caseId: number): Promise<void> {
    try {
      unwrapIpcResult(await requireApi().cases.delete(caseId))
    } finally {
      invalidateCase(caseId)
    }
  }

  /** @returns the number of cases actually deleted */
  async function deleteCases(caseIds: readonly number[]): Promise<number> {
    try {
      return unwrapIpcResult(await requireApi().cases.deleteBatch([...caseIds]))
    } finally {
      caseIds.forEach(invalidateCase)
    }
  }

  /** @returns the number of cases actually deleted */
  async function deleteAllCases(): Promise<number> {
    try {
      return unwrapIpcResult(await requireApi().cases.deleteAll())
    } finally {
      invalidateAllCases()
    }
  }

  return { deleteCase, deleteCases, deleteAllCases }
}
