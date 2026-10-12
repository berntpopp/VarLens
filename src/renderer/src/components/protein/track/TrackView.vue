<template>
  <!-- The body both views share: caption + search + Plot/List, the plot with
       its overview strip, and the neighbourhood of the variant of interest. -->
  <div class="d-flex flex-column track-view">
    <TrackNavBar
      v-model:list="list"
      :nav="nav"
      :caption="caption"
      :search-context="searchContext"
      :search-label="searchLabel"
      :search-hint="searchHint"
    />
    <div class="d-flex flex-grow-1 track-view-body">
      <div class="d-flex flex-column flex-grow-1 track-view-main">
        <TrackPlot
          v-show="!list"
          ref="plotRef"
          class="flex-grow-1"
          :nav="nav"
          :unit="unit"
          :label="plotLabel"
          :draw="draw"
          :deps="deps"
        />
        <TrackOverview
          v-show="!list"
          :nav="nav"
          :extent="extent"
          :features="features"
          :unit="unit"
          :label="`Overview of ${plotLabel}`"
        />
        <TrackVariantList v-if="list" :nav="nav" :rows="allRows" :unit="unit" height="100%" />
      </div>
      <TrackNeighbourhood
        :nav="nav"
        :unit="unit"
        :between-label="betweenLabel"
        :no-features-label="noFeaturesLabel"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import TrackNavBar from './TrackNavBar.vue'
import TrackPlot from './TrackPlot.vue'
import TrackOverview from './TrackOverview.vue'
import TrackVariantList from './TrackVariantList.vue'
import TrackNeighbourhood from './TrackNeighbourhood.vue'
import type { TrackDrawContext } from '../../../composables/track-plot/useTrackPlot'
import type { TrackNavigator } from '../../../composables/useTrackNavigator'
import type { TrackSearchContext } from '../../../utils/track-search'
import type { TrackFeature, TrackWindow } from '../../../utils/track-window'

const props = defineProps<{
  nav: TrackNavigator
  unit: 'aa' | 'bp'
  caption: string
  plotLabel: string
  searchLabel: string
  searchContext: TrackSearchContext
  extent: TrackWindow
  features: TrackFeature[]
  betweenLabel: string
  noFeaturesLabel: string
  /** Accepted search inputs, shown as the search box tooltip */
  searchHint: string
  draw: (ctx: TrackDrawContext) => void
  deps: unknown
}>()

const list = ref(false)
const plotRef = ref<InstanceType<typeof TrackPlot> | null>(null)

/** Every plotted variant but gnomAD (population data, not variants of the case). */
const allRows = computed(() =>
  props.nav.displayMarkers.value
    .filter((m) => m.track !== 'gnomad')
    .sort((a, b) => a.position - b.position)
    .map((marker) => ({ marker }))
)

defineExpose({
  exportSvg: (): string => plotRef.value?.exportSvg() ?? '',
  exportPng: (): Promise<Blob | null> => plotRef.value?.exportPng() ?? Promise.resolve(null)
})
</script>

<style scoped>
.track-view {
  min-height: 0;
}

.track-view-body,
.track-view-main {
  min-height: 0;
  min-width: 0;
}
</style>
