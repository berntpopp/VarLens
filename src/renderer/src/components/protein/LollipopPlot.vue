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
  ClinVarVariant,
  ConsequenceCategory,
  ClinVarSignificance
} from '../../../../shared/types/protein'

interface Props {
  proteinLength: number
  domains: ProteinDomain[]
  variants: LollipopVariant[]
  gnomadVariants: GnomadVariant[]
  clinvarVariants: ClinVarVariant[]
  showGnomad: boolean
  activeCategories: Set<ConsequenceCategory>
  activeClinvarCategories: Set<ClinVarSignificance>
  activeClinvarConsequences: Set<ConsequenceCategory>
  /** Maximum allele frequency filter for gnomAD variants (default 1 = all) */
  gnomadMaxAf?: number
}

const props = withDefaults(defineProps<Props>(), {
  gnomadMaxAf: 1
})

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
  clinvarVariants: toRef(props, 'clinvarVariants'),
  showGnomad: toRef(props, 'showGnomad'),
  activeCategories: toRef(props, 'activeCategories'),
  activeClinvarCategories: toRef(props, 'activeClinvarCategories'),
  activeClinvarConsequences: toRef(props, 'activeClinvarConsequences'),
  gnomadMaxAf: toRef(props, 'gnomadMaxAf')
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
