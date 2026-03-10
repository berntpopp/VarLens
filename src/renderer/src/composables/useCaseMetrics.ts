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

// Global metric definitions cache
const definitionsCache = ref<MetricDefinition[]>([])
const definitionsLoaded = ref(false)

// Per-case metrics cache
const metricsCache = ref<Map<number, CaseMetricWithDefinition[]>>(new Map())
const loadingStates = ref<Map<number, boolean>>(new Map())

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
      definitionsCache.value = await api.caseMetrics.listDefinitions()
      definitionsLoaded.value = true
    } catch (error) {
      console.error('Failed to load metric definitions:', error)
    }
  }

  async function loadMetrics(caseId: number): Promise<void> {
    if (!api) return
    if (loadingStates.value.get(caseId) === true) return

    loadingStates.value.set(caseId, true)
    try {
      const metrics = await api.caseMetrics.listForCase(caseId)
      metricsCache.value.set(caseId, metrics)
    } catch (error) {
      console.error('Failed to load case metrics:', error)
    } finally {
      loadingStates.value.set(caseId, false)
    }
  }

  function getMetrics(caseId: number): CaseMetricWithDefinition[] {
    return metricsCache.value.get(caseId) ?? []
  }

  function isLoading(caseId: number): boolean {
    return loadingStates.value.get(caseId) ?? false
  }

  async function upsertMetric(caseId: number, metricId: number, value: MetricValue): Promise<void> {
    if (!api) return
    await api.caseMetrics.upsert(caseId, metricId, value)
    // Reload to get joined data
    loadingStates.value.delete(caseId) // Allow reload
    metricsCache.value.delete(caseId)
    await loadMetrics(caseId)
  }

  async function deleteMetric(caseId: number, metricId: number): Promise<void> {
    if (!api) return
    await api.caseMetrics.delete(caseId, metricId)

    // Remove from cache
    const cached = metricsCache.value.get(caseId)
    if (cached) {
      metricsCache.value.set(
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
    const def = await api.caseMetrics.createDefinition(name, valueType, unit, category)
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
    metricsCache.value.clear()
    loadingStates.value.clear()
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
    clearCache
  }
}
