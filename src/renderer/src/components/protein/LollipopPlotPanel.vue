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

    <!-- Loading bar for gnomAD / ClinVar fetch -->
    <v-progress-linear
      v-if="gnomadLoading || clinvarLoading"
      indeterminate
      color="info"
      height="2"
    />

    <!-- Plot area -->
    <div class="flex-grow-1 position-relative" style="min-height: 0">
      <LollipopPlot
        ref="plotRef"
        :protein-length="proteinLength"
        :domains="domains"
        :variants="variants"
        :gnomad-variants="gnomadVariants"
        :clinvar-variants="clinvarVariants"
        :show-gnomad="showGnomad"
        :active-categories="activeCategories"
        :active-clinvar-categories="activeClinVarCategories"
        :active-clinvar-consequences="activeClinVarConsequences"
        :gnomad-max-af="gnomadMaxAf"
      />
    </div>

    <!-- Legend -->
    <LollipopLegend
      :active-categories="activeCategories"
      :active-clinvar-categories="activeClinVarCategories"
      :active-clinvar-consequences="activeClinVarConsequences"
      :domains="domains"
      :has-clinvar="clinvarVariants.length > 0"
      :consequence-counts="consequenceCounts"
      :clinvar-counts="clinvarCounts"
      :clinvar-consequence-counts="clinvarConsequenceCounts"
      @toggle-category="handleToggleCategory"
      @select-only-category="handleSelectOnlyCategory"
      @select-all-categories="handleSelectAllCategories"
      @toggle-clinvar-category="handleToggleClinVarCategory"
      @select-only-clinvar="handleSelectOnlyClinVar"
      @select-all-clinvar="handleSelectAllClinVar"
      @toggle-clinvar-consequence="handleToggleClinVarConsequence"
      @select-only-clinvar-consequence="handleSelectOnlyClinVarConsequence"
      @select-all-clinvar-consequences="handleSelectAllClinVarConsequences"
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
  ClinVarVariant,
  ConsequenceCategory,
  ClinVarSignificance
} from '../../../../shared/types/protein'
import {
  CONSEQUENCE_COLORS,
  CLINVAR_COLORS,
  getConsequenceCategory,
  getClinVarCategory
} from '../../../../shared/utils/protein-utils'
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
  /** ClinVar variants (fetched by parent modal, shared across tabs) */
  clinvarVariants: ClinVarVariant[]
  /** Whether ClinVar data is loading */
  clinvarLoading: boolean
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

// ClinVar variants and loading come from props (clinvarVariants, clinvarLoading)

// gnomAD frequency filter (default: show all)
const gnomadMaxAf = ref(1)

/** Count of gnomAD variants after AF + consequence filters */
const filteredGnomadCount = computed(
  () =>
    gnomadVariants.value.filter(
      (gv) =>
        gv.proteinPosition !== null &&
        gv.alleleFrequency <= gnomadMaxAf.value &&
        activeCategories.value.has(getConsequenceCategory(gv.consequence))
    ).length
)

// Filter categories - all active by default
const activeCategories = ref<Set<ConsequenceCategory>>(
  new Set(Object.keys(CONSEQUENCE_COLORS) as ConsequenceCategory[])
)

// ClinVar significance filter categories - all active by default
const activeClinVarCategories = ref<Set<ClinVarSignificance>>(
  new Set(Object.keys(CLINVAR_COLORS) as ClinVarSignificance[])
)

// ClinVar consequence filter categories - all active by default
const activeClinVarConsequences = ref<Set<ConsequenceCategory>>(
  new Set(Object.keys(CONSEQUENCE_COLORS) as ConsequenceCategory[])
)

// Generation counter to discard stale gnomAD results on rapid gene changes
let gnomadGeneration = 0

// Auto-fetch gnomAD data when gene symbol is available
watch(
  () => props.geneSymbol,
  async (gene) => {
    const gen = ++gnomadGeneration
    gnomadVariants.value = []

    if (gene !== null && gene !== '' && api !== undefined) {
      if (showGnomad.value) {
        await fetchGnomad(gene, gen)
      }
    }
  },
  { immediate: true }
)

async function fetchGnomad(gene: string, generation?: number): Promise<void> {
  if (api === undefined) return
  gnomadLoading.value = true
  try {
    const result = await api.gnomad.getVariants(gene)
    // Discard stale results if gene changed while fetching
    if (generation !== undefined && generation !== gnomadGeneration) return
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

function handleSelectOnlyCategory(category: ConsequenceCategory): void {
  activeCategories.value = new Set([category])
}

function handleSelectAllCategories(): void {
  activeCategories.value = new Set(Object.keys(CONSEQUENCE_COLORS) as ConsequenceCategory[])
}

function handleToggleClinVarCategory(category: ClinVarSignificance): void {
  const next = new Set(activeClinVarCategories.value)
  if (next.has(category)) {
    next.delete(category)
  } else {
    next.add(category)
  }
  activeClinVarCategories.value = next
}

function handleSelectOnlyClinVar(category: ClinVarSignificance): void {
  activeClinVarCategories.value = new Set([category])
}

function handleSelectAllClinVar(): void {
  activeClinVarCategories.value = new Set(Object.keys(CLINVAR_COLORS) as ClinVarSignificance[])
}

function handleToggleClinVarConsequence(category: ConsequenceCategory): void {
  const next = new Set(activeClinVarConsequences.value)
  if (next.has(category)) {
    next.delete(category)
  } else {
    next.add(category)
  }
  activeClinVarConsequences.value = next
}

function handleSelectOnlyClinVarConsequence(category: ConsequenceCategory): void {
  activeClinVarConsequences.value = new Set([category])
}

function handleSelectAllClinVarConsequences(): void {
  activeClinVarConsequences.value = new Set(
    Object.keys(CONSEQUENCE_COLORS) as ConsequenceCategory[]
  )
}

/** Compute variant counts per consequence category from gnomAD variants only */
const consequenceCounts = computed(() => {
  const counts: Record<ConsequenceCategory, number> = {
    missense: 0,
    truncating: 0,
    inframe: 0,
    splice: 0,
    synonymous: 0,
    other: 0
  }
  for (const v of gnomadVariants.value) {
    if (v.proteinPosition !== null) {
      const cat = getConsequenceCategory(v.consequence)
      counts[cat]++
    }
  }
  return counts
})

/** Compute variant counts per consequence category from ClinVar variants */
const clinvarConsequenceCounts = computed(() => {
  const counts: Record<ConsequenceCategory, number> = {
    missense: 0,
    truncating: 0,
    inframe: 0,
    splice: 0,
    synonymous: 0,
    other: 0
  }
  for (const v of props.clinvarVariants) {
    if (v.proteinPosition !== null) {
      const cat = getConsequenceCategory(v.consequence)
      counts[cat]++
    }
  }
  return counts
})

/** Compute variant counts per ClinVar significance category */
const clinvarCounts = computed(() => {
  const counts: Record<ClinVarSignificance, number> = {
    pathogenic: 0,
    likely_pathogenic: 0,
    uncertain: 0,
    likely_benign: 0,
    benign: 0,
    other: 0
  }
  for (const v of props.clinvarVariants) {
    if (v.proteinPosition !== null) {
      const cat = getClinVarCategory(v.clinicalSignificance)
      counts[cat]++
    }
  }
  return counts
})

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
