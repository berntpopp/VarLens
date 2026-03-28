<template>
  <div ref="containerRef" class="lollipop-plot-container">
    <svg ref="svgRef" class="lollipop-svg" />
    <ProteinTooltip :data="tooltip" />
  </div>
</template>

<script setup lang="ts">
import { ref, toRef } from 'vue'
import { useResizeObserver } from '../../composables/useResizeObserver'
import { useLollipopPlot } from '../../composables/useLollipopPlot'
import ProteinTooltip from './ProteinTooltip.vue'
import type {
  ProteinDomain,
  LollipopVariant,
  GnomadVariant,
  ConsequenceCategory
} from '../../../../shared/types/protein'

interface Props {
  proteinLength: number
  domains: ProteinDomain[]
  variants: LollipopVariant[]
  gnomadVariants: GnomadVariant[]
  showGnomad: boolean
  activeCategories: Set<ConsequenceCategory>
}

const props = defineProps<Props>()

const containerRef = ref<HTMLElement | null>(null)
const svgRef = ref<SVGSVGElement | null>(null)

const { dimensions } = useResizeObserver(containerRef)

const { tooltip, resetZoom, zoomIn, zoomOut, exportSvg, exportPng } = useLollipopPlot({
  svgRef,
  dimensions,
  proteinLength: toRef(props, 'proteinLength'),
  domains: toRef(props, 'domains'),
  variants: toRef(props, 'variants'),
  gnomadVariants: toRef(props, 'gnomadVariants'),
  showGnomad: toRef(props, 'showGnomad'),
  activeCategories: toRef(props, 'activeCategories')
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
.lollipop-plot-container {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 300px;
}

.lollipop-svg {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
