<template>
  <div class="gene-structure-panel d-flex flex-column fill-height">
    <!-- Toolbar -->
    <v-toolbar density="compact" color="secondary" flat class="gene-structure-toolbar">
      <div class="d-flex align-center ga-1 px-2 flex-wrap">
        <!-- Zoom controls -->
        <v-tooltip location="bottom">
          <template #activator="{ props: tip }">
            <v-btn v-bind="tip" icon size="small" variant="text" @click="plotRef?.zoomIn()">
              <v-icon size="small" :icon="mdiMagnifyPlusOutline" />
            </v-btn>
          </template>
          Zoom in
        </v-tooltip>

        <v-tooltip location="bottom">
          <template #activator="{ props: tip }">
            <v-btn v-bind="tip" icon size="small" variant="text" @click="plotRef?.zoomOut()">
              <v-icon size="small" :icon="mdiMagnifyMinusOutline" />
            </v-btn>
          </template>
          Zoom out
        </v-tooltip>

        <v-tooltip location="bottom">
          <template #activator="{ props: tip }">
            <v-btn v-bind="tip" icon size="small" variant="text" @click="plotRef?.resetZoom()">
              <v-icon size="small" :icon="mdiFitToScreenOutline" />
            </v-btn>
          </template>
          Reset zoom
        </v-tooltip>

        <v-divider vertical class="mx-1" />

        <!-- Info chips -->
        <v-chip v-if="geneStructure" size="small" variant="outlined" class="mr-1">
          {{ geneStructure.exons.length }} exons
        </v-chip>
        <v-chip v-if="geneStructure" size="small" variant="outlined">
          {{ formatGeneLength(geneStructure.end - geneStructure.start) }}
        </v-chip>

        <v-divider vertical class="mx-1" />

        <!-- Export buttons -->
        <v-tooltip location="bottom">
          <template #activator="{ props: tip }">
            <v-btn v-bind="tip" icon size="small" variant="text" @click="handleExportSvg">
              <v-icon size="small" :icon="mdiFileImageOutline" />
            </v-btn>
          </template>
          Export SVG
        </v-tooltip>

        <v-tooltip location="bottom">
          <template #activator="{ props: tip }">
            <v-btn v-bind="tip" icon size="small" variant="text" @click="handleExportPng">
              <v-icon size="small" :icon="mdiImageOutline" />
            </v-btn>
          </template>
          Export PNG
        </v-tooltip>
      </div>
    </v-toolbar>

    <!-- Loading bar -->
    <v-progress-linear v-if="loading || clinvarLoading" indeterminate color="info" height="2" />

    <!-- Error state -->
    <div v-if="error" class="d-flex flex-column align-center justify-center flex-grow-1 pa-8">
      <v-icon size="48" color="warning" :icon="mdiAlertCircleOutline" class="mb-3" />
      <div class="text-body-1 mb-1">Gene Structure Unavailable</div>
      <div class="text-body-2 text-medium-emphasis">{{ error }}</div>
    </div>

    <!-- No data state -->
    <div
      v-else-if="!geneStructure && !loading"
      class="d-flex flex-column align-center justify-center flex-grow-1 pa-8"
    >
      <v-icon size="48" color="grey" :icon="mdiDna" class="mb-3" />
      <div class="text-body-1 mb-1">No Gene Structure Data</div>
      <div class="text-body-2 text-medium-emphasis">
        Exon coordinates could not be loaded from Ensembl.
      </div>
    </div>

    <!-- Plot area -->
    <div v-else-if="geneStructure" class="flex-grow-1 position-relative" style="min-height: 0">
      <GeneStructurePlot
        ref="plotRef"
        :gene-structure="geneStructure"
        :variant="genomicVariant"
        :clinvar-variants="clinvarVariants"
        :active-clinvar-categories="activeClinvarCategories"
      />
    </div>

    <!-- Legend -->
    <div v-if="geneStructure" class="gene-structure-legend pa-2 bg-grey-lighten-4">
      <div class="d-flex align-center ga-1 flex-wrap mb-1">
        <span class="text-body-2 text-medium-emphasis mr-1 font-weight-medium">Legend:</span>
        <v-chip size="small" label variant="flat" color="primary">Exon</v-chip>
        <v-chip size="small" label variant="outlined" color="grey">Intron</v-chip>
        <v-chip v-if="genomicVariant" size="small" label variant="flat" color="error"
          >Your Variant</v-chip
        >
        <span v-if="clinvarVariants.length > 0" class="d-inline-flex align-center ga-1 ml-2">
          <span
            style="
              width: 8px;
              height: 8px;
              transform: rotate(45deg);
              background: #d73027;
              display: inline-block;
            "
          />
          <span class="text-body-2">ClinVar</span>
        </span>
      </div>

      <!-- ClinVar significance filter row -->
      <div v-if="clinvarVariants.length > 0" class="d-flex flex-wrap ga-1 align-center">
        <span
          class="text-body-2 text-medium-emphasis mr-1 font-weight-medium"
          style="min-width: 140px"
          >ClinVar Significance:</span
        >
        <div
          v-for="[category, color] in clinvarEntries"
          :key="category"
          class="filter-pill"
          :class="{ inactive: !isClinVarActive(category) }"
        >
          <v-chip
            size="small"
            label
            :variant="isClinVarActive(category) ? 'flat' : 'outlined'"
            :style="clinvarChipStyle(category, color)"
            class="cursor-pointer"
            @click="toggleClinVar(category)"
          >
            {{ CLINVAR_LABELS[category] }}
            ({{ clinvarCounts[category] ?? 0 }})
          </v-chip>
          <v-btn
            size="x-small"
            variant="text"
            class="only-btn text-none"
            @click.stop="selectOnlyClinVar(category)"
          >
            only
          </v-btn>
        </div>
        <v-chip
          size="small"
          label
          variant="outlined"
          color="grey-darken-1"
          class="ml-2"
          @click="selectAllClinVar()"
        >
          All
        </v-chip>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, type ComponentPublicInstance } from 'vue'
import {
  mdiMagnifyPlusOutline,
  mdiMagnifyMinusOutline,
  mdiFitToScreenOutline,
  mdiFileImageOutline,
  mdiImageOutline,
  mdiAlertCircleOutline,
  mdiDna
} from '@mdi/js'
import GeneStructurePlot from './GeneStructurePlot.vue'
import type {
  GeneStructure,
  ClinVarVariant,
  ClinVarSignificance
} from '../../../../shared/types/protein'
import { CLINVAR_COLORS, getClinVarCategory } from '../../../../shared/utils/protein-utils'
import type { GenomicVariant } from '../../composables/useGeneStructurePlot'

interface Props {
  geneStructure: GeneStructure | null
  loading: boolean
  error: string | null
  /** Variant to display on gene structure */
  variant: GenomicVariant | null
  geneSymbol: string | null
  /** ClinVar variants to display on gene structure */
  clinvarVariants: ClinVarVariant[]
  /** Whether ClinVar data is loading */
  clinvarLoading: boolean
}

const props = defineProps<Props>()

// ClinVar significance filter - all active by default
const activeClinvarCategories = ref<Set<ClinVarSignificance>>(
  new Set(Object.keys(CLINVAR_COLORS) as ClinVarSignificance[])
)

const CLINVAR_LABELS: Record<ClinVarSignificance, string> = {
  pathogenic: 'Pathogenic',
  likely_pathogenic: 'Likely P.',
  uncertain: 'VUS',
  likely_benign: 'Likely B.',
  benign: 'Benign',
  other: 'Other'
}

/** Compute ClinVar variant counts per significance category (only those with genomic position) */
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
    if (v.genomicPosition !== null) {
      const cat = getClinVarCategory(v.clinicalSignificance)
      counts[cat]++
    }
  }
  return counts
})

function isClinVarActive(category: ClinVarSignificance): boolean {
  return activeClinvarCategories.value.has(category)
}

function toggleClinVar(category: ClinVarSignificance): void {
  const next = new Set(activeClinvarCategories.value)
  if (next.has(category)) {
    next.delete(category)
  } else {
    next.add(category)
  }
  activeClinvarCategories.value = next
}

function selectOnlyClinVar(category: ClinVarSignificance): void {
  activeClinvarCategories.value = new Set([category])
}

function selectAllClinVar(): void {
  activeClinvarCategories.value = new Set(Object.keys(CLINVAR_COLORS) as ClinVarSignificance[])
}

function clinvarChipStyle(category: ClinVarSignificance, color: string): Record<string, string> {
  if (isClinVarActive(category)) {
    const textColor = category === 'uncertain' ? '#333' : '#fff'
    return { backgroundColor: color, color: textColor, borderColor: color }
  }
  return { borderColor: color, color, opacity: '0.6' }
}

const clinvarEntries = computed(
  () => Object.entries(CLINVAR_COLORS) as [ClinVarSignificance, string][]
)

const plotRef = ref<ComponentPublicInstance<{
  resetZoom: () => void
  zoomIn: () => void
  zoomOut: () => void
  exportSvg: () => string
  exportPng: () => Promise<Blob | null>
}> | null>(null)

const genomicVariant = computed<GenomicVariant | null>(() => props.variant)

function formatGeneLength(bp: number): string {
  if (bp >= 1_000_000) return `${(bp / 1_000_000).toFixed(1)} Mb`
  if (bp >= 1_000) return `${(bp / 1_000).toFixed(1)} kb`
  return `${bp} bp`
}

function handleExportSvg(): void {
  const svgString = plotRef.value?.exportSvg()
  if (svgString === undefined || svgString === '') return

  const blob = new Blob([svgString], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${props.geneSymbol ?? 'gene'}_structure.svg`
  a.click()
  URL.revokeObjectURL(url)
}

async function handleExportPng(): Promise<void> {
  const blob = await plotRef.value?.exportPng()
  if (!blob) return

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${props.geneSymbol ?? 'gene'}_structure.png`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<style scoped>
.gene-structure-legend {
  border-top: 1px solid #e0e0e0;
}

.cursor-pointer {
  cursor: pointer;
}

.filter-pill {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.filter-pill.inactive {
  opacity: 0.5;
}

.only-btn {
  font-size: 10px;
  min-width: 32px;
  height: 20px;
  padding: 0 4px;
  text-transform: lowercase;
  opacity: 0.6;
}

.only-btn:hover {
  opacity: 1;
}
</style>
