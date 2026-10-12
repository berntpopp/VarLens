<template>
  <v-dialog
    :model-value="modelValue"
    fullscreen
    transition="dialog-bottom-transition"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card class="d-flex flex-column fill-height">
      <!-- Header -->
      <v-toolbar color="secondary" density="comfortable" flat>
        <v-toolbar-title class="d-flex align-center ga-3 ml-4">
          <!-- Gene name -->
          <span v-if="geneSymbol" class="text-h6 font-weight-bold">
            {{ geneSymbol }}
          </span>

          <v-divider v-if="proteinData.mapping.value" vertical class="mx-1" />

          <!-- Protein name -->
          <span v-if="proteinData.mapping.value" class="text-body-1">
            {{ proteinData.mapping.value.proteinName }}
          </span>
          <v-chip
            v-if="proteinData.proteinLength.value > 0"
            size="small"
            variant="outlined"
            color="white"
            class="ml-1"
          >
            {{ proteinData.proteinLength.value }} aa
          </v-chip>

          <!-- UniProt accession -->
          <v-chip
            v-if="proteinData.mapping.value"
            size="small"
            variant="tonal"
            color="white"
            class="ml-1"
          >
            {{ proteinData.mapping.value.uniprotAccession }}
          </v-chip>
        </v-toolbar-title>

        <template #append>
          <!-- Tabs -->
          <v-tabs v-model="activeTab" color="white" density="compact" class="mr-2">
            <v-tab value="lollipop">Lollipop Plot</v-tab>
            <v-tab value="gene-structure">Gene Structure</v-tab>
            <v-tab value="3d">3D Structure</v-tab>
          </v-tabs>

          <v-btn icon variant="text" aria-label="Close" @click="emit('update:modelValue', false)">
            <v-icon :icon="mdiClose" />
          </v-btn>
        </template>
      </v-toolbar>

      <!-- Loading state -->
      <v-progress-linear
        v-if="proteinData.loading.value"
        indeterminate
        color="primary"
        aria-label="Loading protein data"
      />

      <!-- Content area -->
      <div class="flex-grow-1" style="min-height: 0">
        <!-- Error state -->
        <div
          v-if="proteinData.error.value"
          class="d-flex flex-column align-center justify-center fill-height pa-8"
        >
          <v-icon size="64" color="error" :icon="mdiAlertCircleOutline" class="mb-4" />
          <div class="text-h6 mb-2">Failed to Load Protein Data</div>
          <div class="text-body-2 text-medium-emphasis mb-4">
            {{ proteinData.error.value }}
          </div>
          <v-btn variant="outlined" color="primary" @click="proteinData.refetch()"> Retry </v-btn>
        </div>

        <!-- Empty / loading skeleton -->
        <div
          v-else-if="proteinData.loading.value"
          class="d-flex flex-column align-center justify-center fill-height pa-8"
        >
          <v-skeleton-loader type="card" class="w-100" style="max-width: 800px" />
        </div>

        <!-- No protein data available -->
        <div
          v-else-if="!proteinData.mapping.value"
          class="d-flex flex-column align-center justify-center fill-height pa-8"
        >
          <v-icon size="64" color="grey" :icon="mdiDna" class="mb-4" />
          <div class="text-h6 mb-2">No Protein Data</div>
          <div class="text-body-2 text-medium-emphasis">
            Could not find UniProt mapping for {{ geneSymbol ?? 'this gene' }}.
          </div>
        </div>

        <!-- Lollipop Plot tab -->
        <LollipopPlotPanel
          v-else-if="activeTab === 'lollipop'"
          :protein-length="proteinData.proteinLength.value"
          :domains="proteinData.domains.value"
          :variants="lollipopVariants"
          :gene-symbol="geneSymbol"
          :show-case-variants="showCaseVariants"
          :case-variants-loading="caseVariantsLoading"
          :has-case-id="caseId !== null && mode === 'case'"
          :clinvar-variants="clinvarVariants"
          :clinvar-loading="clinvarLoading"
          class="fill-height"
          @toggle-case-variants="handleToggleCaseVariants"
        />

        <!-- Gene Structure tab -->
        <GeneStructurePanel
          v-else-if="activeTab === 'gene-structure'"
          :gene-structure="proteinData.geneStructure.value"
          :loading="proteinData.geneStructureLoading.value"
          :error="proteinData.geneStructureError.value"
          :variant="genomicVariant"
          :variant-build="genomeBuild"
          :gene-symbol="geneSymbol"
          :clinvar-variants="clinvarVariants"
          :clinvar-loading="clinvarLoading"
          class="fill-height"
        />

        <!-- 3D Structure tab -->
        <ProteinStructure3DPanel
          v-else-if="activeTab === '3d'"
          :structure-info="proteinData.structureInfo.value"
          :variants="lollipopVariants"
          :clinvar-variants="clinvarVariants"
          class="fill-height"
        />
      </div>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { mdiClose, mdiAlertCircleOutline, mdiDna } from '@mdi/js'
import { useProteinData } from '../../composables/useProteinData'
import { useApiService } from '../../composables/useApiService'
import { useCapabilityStore } from '../../stores/capabilityStore'
import LollipopPlotPanel from './LollipopPlotPanel.vue'
import GeneStructurePanel from './GeneStructurePanel.vue'
import ProteinStructure3DPanel from './ProteinStructure3DPanel.vue'
import type { Variant } from '../../../../shared/types/api'
import type { CohortVariant } from '../../../../shared/types/cohort'
import type { LollipopVariant, ClinVarVariant } from '../../../../shared/types/protein'
import type { GenomicVariant } from '../../composables/useGeneStructurePlot'
import { buildLollipopVariants } from '../../utils/protein-view'
import type { ProteinViewTab } from '../../config/proteinViewConfig'
import { logService } from '../../services/LogService'
import { variantInterval } from '../../utils/variant-interval'
import { formatHgvs } from '../../utils/formatters'
import { isIpcError, unwrapIpcResult } from '../../../../shared/types/errors'

interface Props {
  modelValue: boolean
  variant: Variant | CohortVariant | null
  caseId: number | null
  mode: 'case' | 'cohort'
  /** Genome build of the variant (case build or cohort row build); null when unknown */
  genomeBuild?: string | null
  /** Tab shown each time the modal opens */
  initialTab?: ProteinViewTab
  /** Cohort view: the cohort's carrier rows of a gene (active filters and build) */
  loadCohortCarriers?: (gene: string) => Promise<CohortVariant[]>
}

const props = withDefaults(defineProps<Props>(), {
  genomeBuild: null,
  initialTab: 'lollipop',
  loadCohortCarriers: undefined
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

// protein.* / gnomad.* are gated on the proteinViewer capability (parity manifest).
const api = useCapabilityStore().canUse('proteinViewer') ? useApiService().api : undefined

const activeTab = ref<ProteinViewTab>(props.initialTab)

// Derive gene symbol from the variant
const geneSymbol = computed<string | null>(() => props.variant?.gene_symbol ?? null)

// Protein data composable - watches geneSymbol reactively
const proteinData = useProteinData(geneSymbol)

// Genomic variant for gene structure view
const genomicVariant = computed<GenomicVariant | null>(() => {
  const v = props.variant
  if (v === null) return null
  const interval = variantInterval(v)
  const label =
    interval !== null
      ? `${'sv_type' in v ? (v.sv_type ?? '') : ''} ${v.chr}:${interval.start}-${interval.end}`.trim()
      : (formatHgvs(v.aa_change) ?? `${v.chr}:${v.pos} ${v.ref}>${v.alt}`)
  return {
    chr: v.chr,
    pos: v.pos,
    end: interval?.end ?? null,
    ref: v.ref,
    alt: v.alt,
    label,
    color: '#D32F2F'
  }
})

// Case variants state
const showCaseVariants = ref(false)
const caseVariantsLoading = ref(false)
const caseVariants = ref<(Variant | CohortVariant)[]>([])

// ClinVar state (shared across Lollipop, Gene Structure, and 3D tabs)
const clinvarLoading = ref(false)
const clinvarVariants = ref<ClinVarVariant[]>([])

// Reset case variants when variant/modal changes
// Note: ClinVar data is NOT reset here because it is keyed on geneSymbol.
// The geneSymbol watcher handles clearing and re-fetching when the gene changes.
// Clearing here would wipe ClinVar data when the modal is closed and reopened
// for the same gene, since geneSymbol hasn't changed and the fetch won't re-fire.
watch(
  () => [props.modelValue, props.variant],
  () => {
    if (props.modelValue) activeTab.value = props.initialTab
    showCaseVariants.value = false
    caseVariants.value = []
    void loadCohortCarriers()
  },
  { immediate: true }
)

// Cohort view: every carrier of the gene is on the plot (no Case toggle).
async function loadCohortCarriers(): Promise<void> {
  const gene = geneSymbol.value
  if (!props.modelValue || gene === null || props.loadCohortCarriers === undefined) return
  caseVariantsLoading.value = true
  try {
    const rows = await props.loadCohortCarriers(gene)
    if (gene !== geneSymbol.value) return
    caseVariants.value = rows
    showCaseVariants.value = true
  } catch (err) {
    logService.error(
      `Failed to fetch cohort carriers: ${err instanceof Error ? err.message : 'Unknown'}`,
      'ProteinVisualizationModal'
    )
  } finally {
    caseVariantsLoading.value = false
  }
}

// Fetch ClinVar data when gene symbol changes (shared across all tabs)
watch(
  geneSymbol,
  async (gene) => {
    clinvarVariants.value = []
    if (
      gene !== null &&
      gene !== '' &&
      api !== undefined &&
      useCapabilityStore().canUse('gnomadVariants')
    ) {
      clinvarLoading.value = true
      try {
        const result = unwrapIpcResult(await api.gnomad.getClinVarVariants(gene))
        if (result.success) {
          clinvarVariants.value = result.variants
        } else {
          logService.warn(`ClinVar fetch failed: ${result.error}`, 'ProteinVisualizationModal')
        }
      } catch (err) {
        logService.error(
          `ClinVar fetch error: ${
            err instanceof Error
              ? err.message
              : isIpcError(err)
                ? (err.userMessage ?? err.message)
                : 'Unknown'
          }`,
          'ProteinVisualizationModal'
        )
      } finally {
        clinvarLoading.value = false
      }
    }
  },
  { immediate: true }
)

// The selected variant (highlighted) + case variants (toggle) or cohort carriers.
const lollipopVariants = computed<LollipopVariant[]>(() =>
  buildLollipopVariants(
    props.variant,
    showCaseVariants.value ? caseVariants.value : [],
    geneSymbol.value
  )
)

// Fetch case variants for the current gene
async function handleToggleCaseVariants(): Promise<void> {
  showCaseVariants.value = !showCaseVariants.value

  if (
    showCaseVariants.value &&
    caseVariants.value.length === 0 &&
    props.caseId !== null &&
    geneSymbol.value !== null &&
    api !== undefined
  ) {
    caseVariantsLoading.value = true
    try {
      const result = unwrapIpcResult(
        await api.variants.query(props.caseId, { gene_symbol: geneSymbol.value }, 0, 1000)
      )
      caseVariants.value = result.data
    } catch (err) {
      logService.error(
        `Failed to fetch case variants: ${err instanceof Error ? err.message : 'Unknown'}`,
        'ProteinVisualizationModal'
      )
    } finally {
      caseVariantsLoading.value = false
    }
  }
}
</script>
