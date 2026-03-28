<template>
  <div class="gene-structure-panel d-flex flex-column fill-height">
    <!-- Toolbar -->
    <v-toolbar density="compact" flat class="bg-grey-lighten-3">
      <v-btn icon size="small" variant="text" @click="plotRef?.zoomIn()">
        <v-icon size="18" :icon="mdiMagnifyPlusOutline" />
        <v-tooltip activator="parent" location="bottom">Zoom In</v-tooltip>
      </v-btn>
      <v-btn icon size="small" variant="text" @click="plotRef?.zoomOut()">
        <v-icon size="18" :icon="mdiMagnifyMinusOutline" />
        <v-tooltip activator="parent" location="bottom">Zoom Out</v-tooltip>
      </v-btn>
      <v-btn icon size="small" variant="text" @click="plotRef?.resetZoom()">
        <v-icon size="18" :icon="mdiMagnifyScan" />
        <v-tooltip activator="parent" location="bottom">Reset Zoom</v-tooltip>
      </v-btn>

      <v-divider vertical class="mx-2" />

      <!-- Info chip -->
      <v-chip v-if="geneStructure" size="small" variant="outlined" class="mr-2">
        {{ geneStructure.exons.length }} exons
      </v-chip>
      <v-chip v-if="geneStructure" size="small" variant="outlined" class="mr-2">
        {{ formatGeneLength(geneStructure.end - geneStructure.start) }}
      </v-chip>

      <v-spacer />

      <!-- Export -->
      <v-btn icon size="small" variant="text" @click="handleExportSvg">
        <v-icon size="18" :icon="mdiFileExportOutline" />
        <v-tooltip activator="parent" location="bottom">Export SVG</v-tooltip>
      </v-btn>
      <v-btn icon size="small" variant="text" @click="handleExportPng">
        <v-icon size="18" :icon="mdiImageOutline" />
        <v-tooltip activator="parent" location="bottom">Export PNG</v-tooltip>
      </v-btn>
    </v-toolbar>

    <!-- Loading bar -->
    <v-progress-linear v-if="loading" indeterminate color="info" height="2" />

    <!-- Error state -->
    <div
      v-if="error"
      class="d-flex flex-column align-center justify-center flex-grow-1 pa-8"
    >
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
      />
    </div>

    <!-- Legend -->
    <div v-if="geneStructure" class="gene-structure-legend px-4 py-2 bg-grey-lighten-4">
      <div class="d-flex align-center ga-4 flex-wrap">
        <div class="d-flex align-center ga-1">
          <span class="legend-swatch legend-exon" />
          <span class="text-caption text-medium-emphasis">Exon</span>
        </div>
        <div class="d-flex align-center ga-1">
          <span class="legend-swatch legend-intron" />
          <span class="text-caption text-medium-emphasis">Intron</span>
        </div>
        <div v-if="genomicVariant" class="d-flex align-center ga-1">
          <span class="legend-swatch legend-variant" />
          <span class="text-caption text-medium-emphasis">Your Variant</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, type ComponentPublicInstance } from 'vue'
import { ref } from 'vue'
import {
  mdiMagnifyPlusOutline,
  mdiMagnifyMinusOutline,
  mdiMagnifyScan,
  mdiFileExportOutline,
  mdiImageOutline,
  mdiAlertCircleOutline,
  mdiDna
} from '@mdi/js'
import GeneStructurePlot from './GeneStructurePlot.vue'
import type { GeneStructure } from '../../../../shared/types/protein'
import type { GenomicVariant } from '../../composables/useGeneStructurePlot'

interface Props {
  geneStructure: GeneStructure | null
  loading: boolean
  error: string | null
  /** Variant to display on gene structure */
  variant: GenomicVariant | null
  geneSymbol: string | null
}

const props = defineProps<Props>()

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

.legend-swatch {
  display: inline-block;
  width: 16px;
  height: 10px;
  border-radius: 2px;
}

.legend-exon {
  background-color: #1867c0;
}

.legend-intron {
  background-color: #9e9e9e;
  height: 2px;
  width: 16px;
}

.legend-variant {
  background-color: #d32f2f;
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
</style>
