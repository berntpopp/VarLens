import { ref, computed } from 'vue'
import { logService } from '../services/LogService'

interface AnalysisGroupOption {
  id: number
  name: string
  group_type: string
}

const groups = ref<AnalysisGroupOption[]>([])
const loading = ref(false)

export function useAnalysisGroups() {
  async function loadGroups(): Promise<void> {
    loading.value = true
    try {
      groups.value = (await window.api.analysisGroups.list()) as AnalysisGroupOption[]
    } catch (error) {
      logService.error(`Failed to load analysis groups: ${error}`, 'useAnalysisGroups')
      groups.value = []
    } finally {
      loading.value = false
    }
  }

  const groupOptions = computed(() => groups.value.map((g) => ({ title: g.name, value: g.id })))

  return { groups, loading, loadGroups, groupOptions }
}
