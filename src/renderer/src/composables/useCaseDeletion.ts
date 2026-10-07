/**
 * Composable owning the case-delete IPC calls and the cache hygiene that must
 * follow them.
 *
 * Deleting a case cascades its rows away in the database, but the renderer's
 * metadata cache would otherwise keep the deleted id until the next database
 * switch, and the query cache would still hold the case's own data (comments,
 * metrics) and data that spans cases (cohort scope, column metadata). Every delete
 * here evicts and invalidates once the IPC call *settles*:
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
import { invalidateServerData } from '../queries/invalidation'

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
      void invalidateServerData('data-changed')
    }
  }

  /** @returns the number of cases actually deleted */
  async function deleteCases(caseIds: readonly number[]): Promise<number> {
    try {
      return unwrapIpcResult(await requireApi().cases.deleteBatch([...caseIds]))
    } finally {
      caseIds.forEach(invalidateCase)
      void invalidateServerData('data-changed')
    }
  }

  /** @returns the number of cases actually deleted */
  async function deleteAllCases(): Promise<number> {
    try {
      return unwrapIpcResult(await requireApi().cases.deleteAll())
    } finally {
      invalidateAllCases()
      void invalidateServerData('data-changed')
    }
  }

  return { deleteCase, deleteCases, deleteAllCases }
}
