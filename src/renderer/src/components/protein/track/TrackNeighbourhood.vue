<template>
  <!-- The variant of interest in context: where it lies, what is around it
       (each count highlights those markers) and the nearby variants. -->
  <section
    v-if="nav.anchor.value && n"
    class="track-neighbourhood pa-2"
    :aria-label="PLOT_COPY.nearby"
  >
    <div class="d-flex align-center ga-1 mb-1">
      <span class="text-body-small text-medium-emphasis">Variant of interest</span>
      <v-spacer />
      <IconButton
        v-if="changed"
        :icon="mdiUndoVariant"
        :label="PLOT_COPY.backToAnchor"
        size="x-small"
        @click="nav.resetAnchor()"
      />
      <IconButton
        :icon="mdiCrosshairsGps"
        :label="PLOT_COPY.zoomToAnchor"
        size="x-small"
        @click="nav.frameAnchor()"
      />
    </div>
    <div class="text-body-medium font-weight-bold mb-1 text-truncate">
      {{ nav.anchor.value.label }}
    </div>
    <div class="text-body-small mb-2" data-testid="neighbourhood-location">{{ location }}</div>

    <v-btn-toggle
      :model-value="nav.half.value"
      mandatory
      density="compact"
      variant="outlined"
      divided
      class="mb-2"
      aria-label="Neighbourhood size"
      @update:model-value="(v: number) => nav.setHalfWidth(v)"
    >
      <v-btn v-for="h in nav.halfWidths" :key="h" :value="h" size="x-small" class="text-none">
        {{ formatHalfWidth(h, unit) }}
      </v-btn>
    </v-btn-toggle>

    <div class="text-body-small mb-1" data-testid="neighbourhood-line">{{ line }}</div>
    <div class="d-flex flex-wrap ga-1 mb-2 count-row">
      <v-btn
        v-for="g in n.clinvar"
        :key="g.cls"
        size="x-small"
        variant="tonal"
        class="text-none"
        :aria-pressed="isOn(g.keys)"
        @click="toggle(g.keys)"
      >
        <span class="count-dot" :style="{ background: CLINVAR_COLORS[g.cls] }" />
        {{ g.keys.length }} {{ g.label }}
      </v-btn>
      <v-btn
        v-if="n.cohort.variants > 0"
        size="x-small"
        variant="tonal"
        class="text-none"
        :aria-pressed="isOn(n.cohort.keys)"
        @click="toggle(n.cohort.keys)"
      >
        {{ n.cohort.variants }} cohort · {{ n.cohort.carriers }} carriers
      </v-btn>
    </div>

    <div v-if="focused" class="d-flex align-center ga-1 mb-2 text-body-small">
      <span class="text-truncate">Focused: {{ focused.label }}</span>
      <v-spacer />
      <v-btn
        size="x-small"
        variant="text"
        color="primary"
        class="text-none"
        @click="nav.setAnchor(focused.key)"
      >
        {{ PLOT_COPY.setAnchor }}
      </v-btn>
    </div>

    <div class="text-body-small font-weight-medium mb-1">{{ PLOT_COPY.nearby }}</div>
    <TrackVariantList
      v-if="n.nearby.length > 0"
      :nav="nav"
      :rows="n.nearby"
      :unit="unit"
      show-distance
      compact
      height="240"
    />
    <div v-else class="text-body-small text-medium-emphasis">{{ PLOT_COPY.noNearby }}</div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { mdiCrosshairsGps, mdiUndoVariant } from '@mdi/js'
import IconButton from '../../common/IconButton.vue'
import TrackVariantList from './TrackVariantList.vue'
import { CLINVAR_COLORS } from '../../../../../shared/utils/protein-utils'
import { PLOT_COPY } from '../../../config/proteinPlotConfig'
import type { TrackNavigator } from '../../../composables/useTrackNavigator'
import {
  formatHalfWidth,
  locationLine,
  neighbourhoodLine
} from '../../../utils/track-neighbourhood'

const props = defineProps<{
  nav: TrackNavigator
  unit: 'aa' | 'bp'
  betweenLabel: string
  noFeaturesLabel: string
}>()

const n = computed(() => props.nav.neighbourhood.value)
const changed = computed(() => props.nav.anchor.value?.key !== props.nav.originalAnchor.value?.key)
const location = computed(() =>
  n.value ? locationLine(n.value, props.unit, props.betweenLabel, props.noFeaturesLabel) : ''
)
const line = computed(() =>
  n.value ? neighbourhoodLine(n.value, props.nav.half.value, props.unit) : ''
)
const focused = computed(() => {
  const m = props.nav.displayMarkers.value.find((x) => x.key === props.nav.focusedKey.value)
  return m && m.isAnchor !== true && m.track !== 'gnomad' ? m : null
})

const isOn = (keys: string[]): boolean =>
  keys.length > 0 && keys.every((k) => props.nav.highlighted.value.has(k))
function toggle(keys: string[]): void {
  props.nav.highlight(isOn(keys) ? [] : keys)
}
</script>

<style scoped>
.track-neighbourhood {
  width: 320px;
  flex: 0 0 320px;
  overflow-y: auto;
  border-left: 1px solid rgba(var(--v-theme-on-surface), 0.12);
}

.count-row {
  min-height: 24px;
}

.count-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 4px;
  border-radius: 2px;
  transform: rotate(45deg);
}
</style>
