<template>
  <div ref="containerRef" class="gene-structure-plot-container">
    <svg ref="svgRef" class="gene-structure-svg" />
    <GeneStructureTooltip :data="tooltip" />
  </div>
</template>

<script setup lang="ts">
import { ref, toRef } from 'vue'
import { useResizeObserver } from '../../composables/useResizeObserver'
import { useGeneStructurePlot, type GenomicVariant } from '../../composables/useGeneStructurePlot'
import GeneStructureTooltip from './GeneStructureTooltip.vue'
import type { GeneStructure } from '../../../../shared/types/protein'

interface Props {
  geneStructure: GeneStructure
  variant: GenomicVariant | null
}

const props = defineProps<Props>()

const containerRef = ref<HTMLElement | null>(null)
const svgRef = ref<SVGSVGElement | null>(null)

const { dimensions } = useResizeObserver(containerRef)

const { tooltip, resetZoom, zoomIn, zoomOut, exportSvg, exportPng } = useGeneStructurePlot({
  svgRef,
  dimensions,
  geneStructure: toRef(props, 'geneStructure'),
  variant: toRef(props, 'variant')
})

defineExpose({
  resetZoom,
  zoomIn,
  zoomOut,
  exportSvg,
  exportPng
})
</script>

<style scoped>
.gene-structure-plot-container {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 300px;
}

.gene-structure-svg {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
