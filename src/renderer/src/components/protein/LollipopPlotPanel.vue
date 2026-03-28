<template>
  <div class="lollipop-plot-panel d-flex flex-column fill-height">
    <!-- Toolbar -->
    <LollipopToolbar
      :show-gnomad="showGnomad"
      :show-case-variants="showCaseVariants"
      :case-variants-loading="caseVariantsLoading"
      :has-case-id="hasCaseId"
      :gnomad-max-af="gnomadMaxAf"
      :gnomad-count="filteredGnomadCount"
      :gnomad-total="gnomadVariants.length"
      @zoom-in="plotRef?.zoomIn()"
      @zoom-out="plotRef?.zoomOut()"
      @zoom-reset="plotRef?.resetZoom()"
      @toggle-gnomad="handleToggleGnomad"
      @toggle-case-variants="emit('toggle-case-variants')"
      @update:gnomad-max-af="gnomadMaxAf = $event"
      @export-svg="handleExportSvg"
      @export-png="handleExportPng"
    />

    <!-- Loading bar for gnomAD fetch -->
    <v-progress-linear v-if="gnomadLoading" indeterminate color="info" height="2" />

    <!-- Plot area -->
    <div class="flex-grow-1 position-relative" style="min-height: 0">
      <LollipopPlot
        ref="plotRef"
        :protein-length="proteinLength"
        :domains="domains"
        :variants="variants"
        :gnomad-variants="gnomadVariants"
        :show-gnomad="showGnomad"
        :active-categories="activeCategories"
        :gnomad-max-af="gnomadMaxAf"
      />
    </div>

    <!-- Legend -->
    <LollipopLegend
      :active-categories="activeCategories"
      :domains="domains"
      @toggle-category="handleToggleCategory"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, type ComponentPublicInstance } from 'vue'
import LollipopToolbar from './LollipopToolbar.vue'
import LollipopPlot from './LollipopPlot.vue'
import LollipopLegend from './LollipopLegend.vue'
import type {
  ProteinDomain,
  LollipopVariant,
  GnomadVariant,
  ConsequenceCategory
} from '../../../../shared/types/protein'
import { CONSEQUENCE_COLORS } from '../../../../shared/utils/protein-utils'
import { useApiService } from '../../composables/useApiService'
import { logService } from '../../services/LogService'

interface Props {
  proteinLength: number
  domains: ProteinDomain[]
  variants: LollipopVariant[]
  geneSymbol: string | null
  /** Whether the "Show case variants" toggle is active (controlled by parent) */
  showCaseVariants: boolean
  /** Whether case variants are currently loading (controlled by parent) */
  caseVariantsLoading: boolean
  /** Whether a case ID is available for fetching case variants */
  hasCaseId: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'toggle-case-variants': []
}>()

const { api } = useApiService()

// Exposed LollipopPlot methods
const plotRef = ref<ComponentPublicInstance<{
  resetZoom: () => void
  zoomIn: () => void
  zoomOut: () => void
  exportSvg: () => string
  exportPng: () => Promise<Blob | null>
}> | null>(null)

// gnomAD state - ON by default
const showGnomad = ref(true)
const gnomadLoading = ref(false)
const gnomadVariants = ref<GnomadVariant[]>([])

// gnomAD frequency filter (default: show all)
const gnomadMaxAf = ref(1)

/** Count of gnomAD variants after AF filter */
const filteredGnomadCount = computed(
  () =>
    gnomadVariants.value.filter(
      (gv) => gv.proteinPosition !== null && gv.alleleFrequency <= gnomadMaxAf.value
    ).length
)

// Filter categories - all active by default
const activeCategories = ref<Set<ConsequenceCategory>>(
  new Set(Object.keys(CONSEQUENCE_COLORS) as ConsequenceCategory[])
)

// Auto-fetch gnomAD data when gene symbol is available (since gnomAD is ON by default)
watch(
  () => props.geneSymbol,
  async (gene) => {
    // Reset gnomAD data when gene changes
    gnomadVariants.value = []

    if (showGnomad.value && gene !== null && gene !== '' && api !== undefined) {
      await fetchGnomad(gene)
    }
  },
  { immediate: true }
)

async function fetchGnomad(gene: string): Promise<void> {
  if (api === undefined) return
  gnomadLoading.value = true
  try {
    const result = await api.gnomad.getVariants(gene)
    if (result.success) {
      gnomadVariants.value = result.variants
    } else {
      logService.warn(`gnomAD fetch failed: ${result.error}`, 'LollipopPlotPanel')
    }
  } catch (err) {
    logService.error(
      `gnomAD fetch error: ${err instanceof Error ? err.message : 'Unknown'}`,
      'LollipopPlotPanel'
    )
  } finally {
    gnomadLoading.value = false
  }
}

async function handleToggleGnomad(): Promise<void> {
  showGnomad.value = !showGnomad.value

  // Fetch gnomAD variants when toggling on if not already loaded
  if (
    showGnomad.value &&
    gnomadVariants.value.length === 0 &&
    props.geneSymbol !== null &&
    props.geneSymbol !== '' &&
    api !== undefined
  ) {
    await fetchGnomad(props.geneSymbol)
  }
}

function handleToggleCategory(category: ConsequenceCategory): void {
  const next = new Set(activeCategories.value)
  if (next.has(category)) {
    next.delete(category)
  } else {
    next.add(category)
  }
  activeCategories.value = next
}

function handleExportSvg(): void {
  const svgString = plotRef.value?.exportSvg()
  if (svgString === undefined || svgString === '') return

  const blob = new Blob([svgString], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${props.geneSymbol ?? 'protein'}_lollipop.svg`
  a.click()
  URL.revokeObjectURL(url)
}

async function handleExportPng(): Promise<void> {
  const blob = await plotRef.value?.exportPng()
  if (!blob) return

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${props.geneSymbol ?? 'protein'}_lollipop.png`
  a.click()
  URL.revokeObjectURL(url)
}
</script>
