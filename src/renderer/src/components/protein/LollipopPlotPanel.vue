<template>
  <div class="lollipop-plot-panel d-flex flex-column fill-height">
    <!-- Toolbar -->
    <LollipopToolbar
      :show-gnomad="showGnomad"
      @zoom-in="plotRef?.zoomIn()"
      @zoom-out="plotRef?.zoomOut()"
      @zoom-reset="plotRef?.resetZoom()"
      @toggle-gnomad="handleToggleGnomad"
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
import { ref, type ComponentPublicInstance } from 'vue'
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
}

const props = defineProps<Props>()

const { api } = useApiService()

// Exposed LollipopPlot methods
const plotRef = ref<ComponentPublicInstance<{
  resetZoom: () => void
  zoomIn: () => void
  zoomOut: () => void
  exportSvg: () => string
  exportPng: () => Promise<Blob | null>
}> | null>(null)

// gnomAD state
const showGnomad = ref(false)
const gnomadLoading = ref(false)
const gnomadVariants = ref<GnomadVariant[]>([])

// Filter categories - all active by default
const activeCategories = ref<Set<ConsequenceCategory>>(
  new Set(Object.keys(CONSEQUENCE_COLORS) as ConsequenceCategory[])
)

async function handleToggleGnomad(): Promise<void> {
  showGnomad.value = !showGnomad.value

  // Fetch gnomAD variants on first toggle
  if (
    showGnomad.value &&
    gnomadVariants.value.length === 0 &&
    props.geneSymbol !== null &&
    props.geneSymbol !== '' &&
    api !== undefined
  ) {
    gnomadLoading.value = true
    try {
      const result = await api.gnomad.getVariants(props.geneSymbol)
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
