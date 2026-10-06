/**
 * Composable for gene burden association analysis.
 *
 * Wraps CohortAPI association methods and case metadata loading
 * with typed access via useApiService (no window.api casting).
 */

import { useApiService } from './useApiService'
import { logService } from '../services/LogService'
import { unwrapIpcResult } from '../../../shared/types/errors'
import { formatError } from '../utils/ipc-result'

interface CaseInfo {
  id: number
  name: string
  status: string | null
  sex: string | null
  cohortIds: number[]
}

interface CohortGroup {
  id: number
  name: string
}

export function useAssociation() {
  const { api } = useApiService()

  async function runAssociation(config: unknown): Promise<unknown> {
    if (!api) throw new Error('API not available')
    return unwrapIpcResult(await api.cohort.runAssociation(config))
  }

  function cancelAssociation(): void {
    if (!api) return
    api.cohort.cancelAssociation().catch((e) => {
      logService.warn(
        'Failed to cancel association: ' + formatError(e, 'unknown error'),
        'association'
      )
    })
  }

  function onAssociationProgress(
    callback: (progress: { completed: number; total: number }) => void
  ): () => void {
    if (!api) return () => {}
    return api.cohort.onAssociationProgress(callback)
  }

  async function loadCasesWithMetadata(): Promise<{
    cases: CaseInfo[]
    cohortGroups: CohortGroup[]
  }> {
    if (!api) return { cases: [], cohortGroups: [] }
    const [caseListResult, cohortsResult] = await Promise.all([
      api.cases.list(),
      api.caseMetadata.listCohorts()
    ])
    const caseList = unwrapIpcResult(caseListResult)
    const cohorts = unwrapIpcResult(cohortsResult)
    const cases = await Promise.all(
      caseList.map(async (c: { id: number; name: string }) => {
        try {
          const fullMeta = unwrapIpcResult(await api.caseMetadata.getFullMetadata(c.id))
          return {
            id: c.id,
            name: c.name,
            status: fullMeta?.metadata?.affected_status ?? null,
            sex: fullMeta?.metadata?.sex ?? null,
            cohortIds: fullMeta?.cohorts?.map((co: CohortGroup) => co.id) ?? []
          }
        } catch (e) {
          logService.warn(
            `Failed to load metadata for case ${c.id}: ` + formatError(e, 'unknown error'),
            'association'
          )
          return { id: c.id, name: c.name, status: null, sex: null, cohortIds: [] }
        }
      })
    )
    return { cases, cohortGroups: cohorts }
  }

  return { runAssociation, cancelAssociation, onAssociationProgress, loadCasesWithMetadata }
}
