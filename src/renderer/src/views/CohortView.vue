<script setup lang="ts">
import CohortViewComponent from '../components/CohortView.vue'
import { useAppState } from '../composables/useAppState'
import { useRouter } from 'vue-router'
import type { Variant } from '../../../shared/types/api'
import type { CohortVariant } from '../../../shared/types/cohort'

const router = useRouter()
const {
  selectedCaseId,
  selectedCaseName,
  activeTab,
  initialSearch,
  panelOpen,
  selectedPanelVariant,
  cohortViewRef
} = useAppState()

async function handleNavigateToCase(payload: {
  caseId: number
  chr: string
  pos: number
  ref: string
  alt: string
  geneSymbol: string | null
  cdna: string | null
}): Promise<void> {
  // eslint-disable-next-line no-undef
  if (typeof window.api === 'undefined') return

  // Build search query from gene symbol and/or cDNA
  const parts: string[] = []
  if (payload.geneSymbol != null && payload.geneSymbol !== '') {
    parts.push(payload.geneSymbol)
  }
  if (payload.cdna != null && payload.cdna !== '') {
    parts.push(payload.cdna)
  }
  const variantSearch = parts.length > 0 ? parts.join(' AND ') : undefined

  initialSearch.value = variantSearch
  activeTab.value = 'case'
  selectedCaseId.value = payload.caseId

  // Look up case name
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-undef
    const cases = await (window as any).api.cases.list()
    const selectedCase = cases.find((c: { id: number }) => c.id === payload.caseId)
    if (selectedCase !== undefined) {
      selectedCaseName.value = selectedCase.name
    }
  } catch (error) {
    // eslint-disable-next-line no-undef
    console.error('Failed to fetch case name:', error)
  }

  router.push('/case')
}

function handleRowClick(variant: Variant | CohortVariant): void {
  selectedPanelVariant.value = variant
  panelOpen.value = true
}
</script>

<template>
  <CohortViewComponent
    ref="cohortViewRef"
    @navigate-to-case="handleNavigateToCase"
    @row-click="handleRowClick"
  />
</template>
