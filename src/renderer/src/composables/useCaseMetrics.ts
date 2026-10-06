/**
 * Composable for case metrics state management
 *
 * Provides reactive metric state per case with IPC-backed persistence.
 * Manages the metric definitions catalog (predefined + user-created).
 * Used by CaseMetricsTab for metric CRUD.
 */

import { ref, computed } from 'vue'
import type {
  MetricDefinition,
  CaseMetricWithDefinition,
  MetricValue
} from '../../../shared/types/api'
import { useApiService } from './useApiService'
import { logService } from '../services/LogService'
import { isIpcError, unwrapIpcResult } from '../../../shared/types/errors'
import { createPerCaseCache } from './per-case-cache'

// Global metric definitions cache
const definitionsCache = ref<MetricDefinition[]>([])
const definitionsLoaded = ref(false)

// Per-case metrics cache — bounded LRU. Lists are replaced, never mutated in place.
const metricsCache = createPerCaseCache<CaseMetricWithDefinition[]>()

export function useCaseMetrics() {
  const { api } = useApiService()

  // Computed: definitions grouped by category
  const definitionsByCategory = computed(() => {
    const grouped = new Map<string, MetricDefinition[]>()
    for (const def of definitionsCache.value) {
      const list = grouped.get(def.category) ?? []
      list.push(def)
      grouped.set(def.category, list)
    }
    return grouped
  })

  async function loadDefinitions(): Promise<void> {
    if (!api) return
    if (definitionsLoaded.value) return
    try {
      definitionsCache.value = unwrapIpcResult(await api.caseMetrics.listDefinitions())
      definitionsLoaded.value = true
    } catch (error) {
      logService.error(
        'Failed to load metric definitions: ' +
          (error instanceof Error
            ? error.message
            : isIpcError(error)
              ? (error.userMessage ?? error.message)
              : String(error)),
        'metrics'
      )
    }
  }

  async function loadMetrics(caseId: number): Promise<void> {
    if (!api) return
    try {
      await metricsCache.load(caseId, async () =>
        unwrapIpcResult(await api.caseMetrics.listForCase(caseId))
      )
    } catch (error) {
      logService.error(
        'Failed to load case metrics: ' +
          (error instanceof Error
            ? error.message
            : isIpcError(error)
              ? (error.userMessage ?? error.message)
              : String(error)),
        'metrics'
      )
    }
  }

  function getMetrics(caseId: number): CaseMetricWithDefinition[] {
    return metricsCache.get(caseId) ?? []
  }

  function isLoading(caseId: number): boolean {
    return metricsCache.isLoading(caseId)
  }

  async function upsertMetric(caseId: number, metricId: number, value: MetricValue): Promise<void> {
    if (!api) return
    unwrapIpcResult(await api.caseMetrics.upsert(caseId, metricId, value))
    // Reload to get joined data
    metricsCache.invalidate(caseId) // Allow reload
    await loadMetrics(caseId)
  }

  async function deleteMetric(caseId: number, metricId: number): Promise<void> {
    if (!api) return
    unwrapIpcResult(await api.caseMetrics.delete(caseId, metricId))

    // Remove from cache
    const cached = metricsCache.get(caseId)
    if (cached) {
      metricsCache.set(
        caseId,
        cached.filter((m) => m.metric_id !== metricId)
      )
    }
  }

  async function createDefinition(
    name: string,
    valueType: 'numeric' | 'text' | 'date',
    unit: string,
    category: string
  ): Promise<MetricDefinition | null> {
    if (!api) return null
    const def = unwrapIpcResult(
      await api.caseMetrics.createDefinition(name, valueType, unit, category)
    )
    definitionsCache.value.push(def)
    // Re-sort
    definitionsCache.value.sort(
      (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)
    )
    return def
  }

  function clearCache(): void {
    definitionsCache.value = []
    definitionsLoaded.value = false
    metricsCache.clear()
  }

  /** Drop one case's metrics (e.g. after the case is deleted). */
  function invalidateCase(caseId: number): void {
    metricsCache.invalidate(caseId)
  }

  /** Drop every case's metrics but keep the definitions catalog. */
  function invalidateAllCases(): void {
    metricsCache.clear()
  }

  return {
    definitionsCache,
    definitionsByCategory,
    loadDefinitions,
    loadMetrics,
    getMetrics,
    isLoading,
    upsertMetric,
    deleteMetric,
    createDefinition,
    clearCache,
    invalidateCase,
    invalidateAllCases
  }
}
