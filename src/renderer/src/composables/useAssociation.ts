/**
 * Composable for gene burden association analysis.
 *
 * Wraps CohortAPI association methods and case metadata loading
 * with typed access via useApiService (no window.api casting).
 */

import { useApiService } from './useApiService'
import { logService } from '../services/LogService'

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
    return api.cohort.runAssociation(config)
  }

  function cancelAssociation(): void {
    if (!api) return
    api.cohort.cancelAssociation().catch((e) => {
      logService.warn(
        'Failed to cancel association: ' + (e instanceof Error ? e.message : String(e)),
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
    const [caseList, cohorts] = await Promise.all([
      api.cases.list(),
      api.caseMetadata.listCohorts()
    ])
    const cases = await Promise.all(
      caseList.map(async (c: { id: number; name: string }) => {
        try {
          const fullMeta = await api.caseMetadata.getFullMetadata(c.id)
          return {
            id: c.id,
            name: c.name,
            status: fullMeta?.metadata?.affected_status ?? null,
            sex: fullMeta?.metadata?.sex ?? null,
            cohortIds: fullMeta?.cohorts?.map((co: CohortGroup) => co.id) ?? []
          }
        } catch (e) {
          logService.warn(
            `Failed to load metadata for case ${c.id}: ` +
              (e instanceof Error ? e.message : String(e)),
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
