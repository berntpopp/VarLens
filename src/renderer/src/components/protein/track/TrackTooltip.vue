<template>
  <Teleport to="body">
    <div
      v-if="data.visible && title !== ''"
      class="track-tooltip"
      :style="style"
      role="presentation"
    >
      <div class="track-tooltip-title">{{ title }}</div>
      <div v-for="[label, value] in rows" :key="label" class="track-tooltip-row">
        <span class="track-tooltip-label">{{ label }}</span>
        <span>{{ value }}</span>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { TrackTooltipData } from '../../../composables/track-plot/useTrackPlot'
import { CLINVAR_CLASS_LABELS, TRACK_LABELS } from '../../../config/proteinPlotConfig'
import { formatConsequence } from '../../../utils/formatters'
import { carrierLabel } from '../../../utils/protein-view'

const props = defineProps<{ data: TrackTooltipData; unit: 'aa' | 'bp' }>()

const fmt = (n: number): string => Math.round(n).toLocaleString('en-US')

const title = computed(() => {
  const { marker, feature } = props.data
  if (feature) return feature.name
  if (!marker) return ''
  return marker.carriers !== null && marker.carriers !== undefined
    ? `${marker.label} · ${carrierLabel(marker.carriers)}`
    : marker.label
})

/** [label, value] rows: what the marker or feature is, in words. */
const rows = computed<Array<[string, string]>>(() => {
  const { marker: m, feature: f } = props.data
  if (f) {
    return [
      ['Range', `${fmt(f.start)}–${fmt(f.end)} ${props.unit}`],
      ['Length', `${fmt(f.end - f.start + 1)} ${props.unit}`],
      ['Click', 'zoom to it']
    ]
  }
  if (!m) return []
  const out: Array<[string, string]> = [['Track', TRACK_LABELS[m.track]]]
  out.push([
    'Position',
    props.unit === 'aa' ? `p.${fmt(m.position)}` : `${m.chr ?? ''}:${fmt(m.position)}`
  ])
  if (m.binnedKeys !== undefined) out.push(['Here', `${m.binnedKeys.length} variants · zoom in`])
  if (typeof m.consequence === 'string' && m.consequence !== '')
    out.push(['Consequence', formatConsequence(m.consequence)])
  if (m.clinvarClass) {
    out.push(['ClinVar', `${CLINVAR_CLASS_LABELS[m.clinvarClass]} ${'★'.repeat(m.stars ?? 0)}`])
  }
  if (m.af !== null && m.af !== undefined) out.push(['gnomAD AF', m.af.toExponential(2)])
  if (m.isAnchor === true) out.push(['', 'Variant of interest'])
  return out
})

const style = computed(() => {
  const pad = 12
  const flipX = props.data.x + 300 > window.innerWidth - pad
  const flipY = props.data.y + 180 > window.innerHeight - pad
  return {
    left: `${flipX ? props.data.x - 290 : props.data.x + pad}px`,
    top: `${flipY ? props.data.y - 170 : props.data.y + pad}px`
  }
})
</script>

<style scoped>
.track-tooltip {
  position: fixed;
  z-index: 9999;
  max-width: 280px;
  padding: 8px 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 6px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.14);
  font-size: 12px;
  line-height: 1.45;
  pointer-events: none;
}

.track-tooltip-title {
  margin-bottom: 2px;
  font-weight: 600;
}

.track-tooltip-row {
  display: flex;
  gap: 6px;
}

.track-tooltip-label {
  min-width: 78px;
  color: rgba(var(--v-theme-on-surface), 0.62);
}
</style>
