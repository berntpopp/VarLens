<template>
  <!-- A light "paper" figure in both themes, like its PNG export. The frame
       owns the plot keys (+ − ← → Home); a focused marker owns ← → Enter Esc. -->
  <v-theme-provider theme="warmLight" with-background class="bg-surface track-plot">
    <div
      ref="containerRef"
      class="track-plot-frame"
      tabindex="0"
      role="group"
      :aria-label="`${label}. ${PLOT_COPY.keyboardHint}`"
      :data-tooltip="PLOT_COPY.keyboardHint"
      data-tooltip-location="top"
      @keydown="nav.onKeydown"
    >
      <svg ref="svgRef" class="track-plot-svg" />
    </div>
    <div class="visually-hidden" aria-live="polite">{{ liveText }}</div>
    <TrackTooltip :data="tooltip" :unit="unit" />
  </v-theme-provider>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { PLOT_COPY } from '../../../config/proteinPlotConfig'
import { useResizeObserver } from '../../../composables/useResizeObserver'
import {
  markerAriaLabel,
  useTrackPlot,
  type TrackDrawContext
} from '../../../composables/track-plot/useTrackPlot'
import type { TrackNavigator } from '../../../composables/useTrackNavigator'
import TrackTooltip from './TrackTooltip.vue'

const props = defineProps<{
  nav: TrackNavigator
  unit: 'aa' | 'bp'
  /** Accessible name of the plot, e.g. "Lollipop plot of THOC5" */
  label: string
  draw: (ctx: TrackDrawContext) => void
  /** Reactive inputs of `draw` other than the navigator */
  deps: unknown
}>()

const containerRef = ref<HTMLElement | null>(null)
const svgRef = ref<SVGSVGElement | null>(null)
const { dimensions } = useResizeObserver(containerRef)

const { tooltip, exportSvg, exportPng } = useTrackPlot({
  svgRef,
  dimensions,
  nav: props.nav,
  unit: props.unit,
  deps: () => props.deps,
  draw: (ctx) => props.draw(ctx)
})

/** Read out the focused marker (screen readers; the tooltip shows it visually). */
const liveText = computed(() => {
  const m = props.nav.displayMarkers.value.find((x) => x.key === props.nav.focusedKey.value)
  return m === undefined ? '' : markerAriaLabel(m, props.unit)
})

defineExpose({ exportSvg, exportPng })
</script>

<style scoped>
.track-plot {
  position: relative;
  min-height: 0;
}

.track-plot-frame {
  position: absolute;
  inset: 0;
  outline: none;
  touch-action: none;
}

.track-plot-frame:focus-visible {
  box-shadow: inset 0 0 0 2px rgb(var(--v-theme-primary));
}

.track-plot-svg {
  display: block;
  width: 100%;
  height: 100%;
  user-select: none;
}

.track-plot-svg :deep(.track-marker:focus) {
  outline: none;
}

.track-plot-svg :deep(.track-marker:focus-visible circle),
.track-plot-svg :deep(.track-marker:focus-visible path),
.track-plot-svg :deep(.track-marker.is-focused circle),
.track-plot-svg :deep(.track-marker.is-focused path) {
  stroke: rgb(var(--v-theme-on-surface));
  stroke-width: 2.5px;
}

.track-plot-svg :deep(.track-marker.is-highlighted circle),
.track-plot-svg :deep(.track-marker.is-highlighted path) {
  stroke: rgb(var(--v-theme-primary));
  stroke-width: 3px;
}
</style>
