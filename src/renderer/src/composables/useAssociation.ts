/**
 * Composable for gene burden association analysis.
 *
 * Wraps CohortAPI association methods and case metadata loading
 * with typed access via useApiService (no window.api casting).
 */

import { computed } from 'vue'
import { useApiService } from './useApiService'
import { useCapabilityStore } from '../stores/capabilityStore'
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
  // Association runs in both runtimes (web: per-user runs on Postgres). The
  // capability still decides availability, so a session without it (e.g. no
  // capability document yet) shows the reason instead of failing.
  const capabilities = useCapabilityStore()
  const unavailableReason = computed(() => capabilities.capabilityReason('cohortAssociation'))

  async function runAssociation(config: unknown): Promise<unknown> {
    if (!api) throw new Error('API not available')
    capabilities.requireCapability('cohortAssociation')
    return unwrapIpcResult(await api.cohort.runAssociation(config))
  }

  function cancelAssociation(): void {
    if (!api || !capabilities.canUse('cohortAssociation')) return
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
    if (!api || !capabilities.canUse('cohortAssociation')) return () => {}
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

  return {
    runAssociation,
    cancelAssociation,
    onAssociationProgress,
    loadCasesWithMetadata,
    unavailableReason
  }
}
