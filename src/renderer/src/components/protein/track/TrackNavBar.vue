<template>
  <!-- One line that says how to read the view, the search, and Plot / List. -->
  <div class="d-flex align-center ga-2 px-3 py-1 flex-wrap track-nav-bar">
    <span class="text-body-small text-medium-emphasis track-caption">{{ caption }}</span>
    <v-spacer />
    <TrackSearch :nav="nav" :context="searchContext" :label="searchLabel" :hint="searchHint" />
    <v-btn-toggle
      v-model="list"
      mandatory
      density="compact"
      variant="outlined"
      divided
      aria-label="Show as"
    >
      <v-btn
        :value="false"
        size="x-small"
        class="text-none"
        :prepend-icon="mdiChartBellCurveCumulative"
      >
        {{ PLOT_COPY.plot }}
      </v-btn>
      <v-btn :value="true" size="x-small" class="text-none" :prepend-icon="mdiFormatListBulleted">
        {{ PLOT_COPY.list }}
      </v-btn>
    </v-btn-toggle>
  </div>
</template>

<script setup lang="ts">
import { mdiChartBellCurveCumulative, mdiFormatListBulleted } from '@mdi/js'
import TrackSearch from './TrackSearch.vue'
import { PLOT_COPY } from '../../../config/proteinPlotConfig'
import type { TrackNavigator } from '../../../composables/useTrackNavigator'
import type { TrackSearchContext } from '../../../utils/track-search'

defineProps<{
  nav: TrackNavigator
  caption: string
  searchContext: TrackSearchContext
  searchLabel: string
  searchHint: string
}>()

const list = defineModel<boolean>('list', { default: false })
</script>

<style scoped>
.track-nav-bar {
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.12);
}

.track-caption {
  min-width: 0;
  flex: 1 1 320px;
}
</style>
