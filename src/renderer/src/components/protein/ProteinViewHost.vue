<template>
  <!-- The shell's protein view, opened by the details panel, the row quick
       menu or `p` (appState.openProteinView). Never looks anything up while
       it cannot open: the dialog says why instead. -->
  <ProteinVisualizationModal
    v-if="reason === null"
    v-model="proteinViewOpen"
    :variant="variant"
    :initial-tab="tab"
    :case-id="caseId"
    :mode="panelMode"
    :genome-build="genomeBuild"
    :load-cohort-carriers="loadCohortCarriers"
  />
  <ProteinViewUnavailableDialog v-else v-model="proteinViewOpen" :reason="reason" />
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, reactive } from 'vue'
import { useAppState } from '../../composables/useAppState'
import { useCapabilityStore } from '../../stores/capabilityStore'
import { useVariantGenomeBuild } from '../../composables/useVariantGenomeBuild'
import { proteinViewBlockedReason, proteinViewTabFor } from '../../utils/protein-view'
import ProteinViewUnavailableDialog from './ProteinViewUnavailableDialog.vue'

const ProteinVisualizationModal = defineAsyncComponent(
  () => import('./ProteinVisualizationModal.vue')
)

const { proteinViewOpen, proteinViewRequest, panelMode, activeTab, selectedCaseId, cohortViewRef } =
  useAppState()
const capabilities = useCapabilityStore()

const variant = computed(() => proteinViewRequest.value?.variant ?? null)
const caseId = computed(() => (activeTab.value === 'case' ? selectedCaseId.value : null))
const genomeBuild = useVariantGenomeBuild(reactive({ variant, caseId }))
// No protein position (SV, intronic): the gene structure is the tab that shows it.
const tab = computed(() =>
  proteinViewRequest.value === null
    ? undefined
    : proteinViewTabFor(proteinViewRequest.value.variant, proteinViewRequest.value.tab)
)
const reason = computed(() =>
  proteinViewBlockedReason(variant.value, capabilities.canUse('proteinViewer'))
)

// Cohort view: the cohort's carriers of the gene, under its active filters.
const loadCohortCarriers = computed(() =>
  panelMode.value === 'cohort'
    ? (gene: string) => cohortViewRef.value?.queryGeneCarriers(gene) ?? Promise.resolve([])
    : undefined
)
</script>
