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
    <v-progress-linear v-if="loading" indeterminate color="info" height="2" />

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
      <GeneStructurePlot ref="plotRef" :gene-structure="geneStructure" :variant="genomicVariant" />
    </div>

    <!-- Legend -->
    <div v-if="geneStructure" class="gene-structure-legend pa-2 bg-grey-lighten-4">
      <div class="d-flex align-center ga-1 flex-wrap">
        <span class="text-body-2 text-medium-emphasis mr-1 font-weight-medium">Legend:</span>
        <v-chip size="small" label variant="flat" color="primary">Exon</v-chip>
        <v-chip size="small" label variant="outlined" color="grey">Intron</v-chip>
        <v-chip v-if="genomicVariant" size="small" label variant="flat" color="error"
          >Your Variant</v-chip
        >
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
  mdiFitToScreenOutline,
  mdiFileImageOutline,
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
</style>
