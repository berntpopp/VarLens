<template>
  <!-- The whole protein / gene with the visible window: drag the window to
       pan, drag elsewhere to choose a new window, click to centre there. -->
  <div
    ref="stripRef"
    class="track-overview"
    :style="{ marginLeft: `${TRACK_GUTTER_PX}px`, marginRight: `${PLOT_RIGHT_PX}px` }"
    role="slider"
    tabindex="0"
    :aria-label="label"
    :aria-valuemin="extent.start"
    :aria-valuemax="extent.end"
    :aria-valuenow="Math.round((nav.window.value.start + nav.window.value.end) / 2)"
    :aria-valuetext="`${fmt(nav.window.value.start)}–${fmt(nav.window.value.end)} ${unit}`"
    @keydown="nav.onKeydown"
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onUp"
  >
    <svg width="100%" height="22" aria-hidden="true">
      <rect x="0" y="9" width="100%" height="4" rx="2" class="overview-backbone" />
      <rect
        v-for="f in features"
        :key="f.key"
        :x="pct(f.start)"
        y="7"
        :width="wpct(Math.max(f.end - f.start, span / 400))"
        height="8"
        :fill="f.color ?? 'rgb(var(--v-theme-primary))'"
        opacity="0.7"
      />
      <line
        v-for="m in ticks"
        :key="m.key"
        :x1="pct(m.position)"
        :x2="pct(m.position)"
        :y1="m.isAnchor ? 0 : 3"
        :y2="m.isAnchor ? 22 : 7"
        :stroke="m.isAnchor ? 'rgb(var(--v-theme-on-surface))' : m.color"
        :stroke-width="m.isAnchor ? 2 : 1"
      />
      <rect
        :x="pct(nav.window.value.start)"
        y="1"
        :width="wpct(nav.window.value.end - nav.window.value.start)"
        height="20"
        rx="2"
        class="overview-window"
      />
    </svg>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { TRACK_GUTTER_PX } from '../../../config/proteinPlotConfig'
import { PLOT_RIGHT_PX } from '../../../composables/track-plot/useTrackPlot'
import type { TrackNavigator } from '../../../composables/useTrackNavigator'
import type { TrackFeature, TrackWindow } from '../../../utils/track-window'

const props = defineProps<{
  nav: TrackNavigator
  extent: TrackWindow
  features: TrackFeature[]
  unit: 'aa' | 'bp'
  label: string
}>()

const stripRef = ref<HTMLElement | null>(null)
const span = computed(() => Math.max(1, props.extent.end - props.extent.start))
const pct = (v: number): string => `${((v - props.extent.start) / span.value) * 100}%`
const wpct = (v: number): string => `${(v / span.value) * 100}%`
const fmt = (v: number): string => Math.round(v).toLocaleString('en-US')
/** Variant ticks (not gnomAD, which would fill the strip). */
const ticks = computed(() =>
  props.nav.displayMarkers.value.filter((m) => m.track !== 'gnomad').slice(0, 2000)
)

const toPos = (clientX: number): number => {
  const box = stripRef.value?.getBoundingClientRect()
  if (!box || box.width === 0) return props.extent.start
  return props.extent.start + ((clientX - box.left) / box.width) * span.value
}

let drag: { mode: 'move' | 'brush'; from: number; window: TrackWindow; moved: boolean } | null =
  null

function onDown(e: PointerEvent): void {
  const at = toPos(e.clientX)
  const w = props.nav.window.value
  drag = {
    mode: at >= w.start && at <= w.end ? 'move' : 'brush',
    from: at,
    window: w,
    moved: false
  }
  stripRef.value?.setPointerCapture(e.pointerId)
}

function onMove(e: PointerEvent): void {
  if (drag === null) return
  const at = toPos(e.clientX)
  drag.moved = drag.moved || Math.abs(at - drag.from) > span.value / 500
  if (!drag.moved) return
  if (drag.mode === 'move') {
    const d = at - drag.from
    props.nav.setWindow({ start: drag.window.start + d, end: drag.window.end + d })
  } else {
    props.nav.setWindow({ start: Math.min(drag.from, at), end: Math.max(drag.from, at) })
  }
}

function onUp(e: PointerEvent): void {
  if (drag !== null && !drag.moved) {
    // A click: centre the current window there.
    const half = (drag.window.end - drag.window.start) / 2
    const at = toPos(e.clientX)
    props.nav.setWindow({ start: at - half, end: at + half })
  }
  drag = null
}
</script>

<style scoped>
.track-overview {
  height: 22px;
  margin-top: 2px;
  margin-bottom: 4px;
  cursor: pointer;
  touch-action: none;
  border-radius: 3px;
}

.track-overview:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
}

.overview-backbone {
  fill: rgba(var(--v-theme-on-surface), 0.16);
}

.overview-window {
  fill: rgba(var(--v-theme-primary), 0.12);
  stroke: rgb(var(--v-theme-primary));
  stroke-width: 1.5;
  cursor: grab;
}
</style>
