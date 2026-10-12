<template>
  <!-- The plotted variants as a table: a screen-reader alternative to the
       plot, and a quick way to jump to one or make it the variant of interest. -->
  <v-data-table
    :headers="headers"
    :items="items"
    item-value="key"
    density="compact"
    :items-per-page="-1"
    hide-default-footer
    fixed-header
    :height="height"
    class="track-variant-list text-body-small"
    :row-props="rowProps"
    @click:row="(_e: unknown, row: { item: Row }) => goTo(row.item)"
  >
    <template #[`item.change`]="{ item }">
      <span :class="{ 'font-weight-bold': item.anchor }">{{ item.change }}</span>
      <span v-if="item.anchor" class="visually-hidden"> (variant of interest)</span>
    </template>
    <template #[`item.actions`]="{ item }">
      <IconButton
        v-if="!item.anchor"
        :icon="mdiTarget"
        :label="`${PLOT_COPY.setAnchor}: ${item.change}`"
        size="x-small"
        @click.stop="nav.setAnchor(item.key)"
      />
    </template>
  </v-data-table>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { mdiTarget } from '@mdi/js'
import IconButton from '../../common/IconButton.vue'
import {
  CLINVAR_CLASS_LABELS,
  PLOT_COPY,
  TRACK_LABELS,
  VARIANT_LIST_HEADERS as H
} from '../../../config/proteinPlotConfig'
import type { TrackNavigator } from '../../../composables/useTrackNavigator'
import type { TrackMarker } from '../../../utils/track-window'

const props = withDefaults(
  defineProps<{
    nav: TrackNavigator
    rows: Array<{ marker: TrackMarker; distance?: number }>
    unit: 'aa' | 'bp'
    showDistance?: boolean
    /** Narrow side panel: one Source column instead of Track / ClinVar / Carriers */
    compact?: boolean
    height?: string | number
  }>(),
  { showDistance: false, compact: false, height: undefined }
)

interface Row {
  key: string
  position: number
  distance: number | null
  change: string
  track: string
  clinvar: string
  carriers: number | null
  source: string
  anchor: boolean
}

const items = computed<Row[]>(() =>
  props.rows.map(({ marker: m, distance }) => ({
    key: m.key,
    position: Math.round(m.position),
    distance: distance ?? null,
    change: m.label,
    track: TRACK_LABELS[m.track],
    clinvar: m.clinvarClass
      ? `${CLINVAR_CLASS_LABELS[m.clinvarClass]} ${'★'.repeat(m.stars ?? 0)}`
      : '',
    carriers: m.carriers ?? null,
    source: m.clinvarClass
      ? `${CLINVAR_CLASS_LABELS[m.clinvarClass]} ${'★'.repeat(m.stars ?? 0)}`
      : m.carriers !== null && m.carriers !== undefined
        ? `${m.carriers} carriers`
        : TRACK_LABELS[m.track],
    anchor: m.isAnchor === true
  }))
)

const headers = computed(() => [
  props.showDistance
    ? { title: `${H.distance} (${props.unit})`, key: 'distance' }
    : { title: `${H.position} (${props.unit})`, key: 'position' },
  { title: H.change, key: 'change' },
  ...(props.compact
    ? [{ title: H.source, key: 'source' }]
    : [
        { title: H.track, key: 'track' },
        { title: H.clinvar, key: 'clinvar' },
        { title: H.carriers, key: 'carriers', align: 'end' as const }
      ]),
  { title: '', key: 'actions', sortable: false, width: 36 }
])

const rowProps = ({ item }: { item: Row }) => ({
  class: { 'track-row--focused': item.key === props.nav.focusedKey.value },
  tabindex: 0,
  onKeydown: (e: KeyboardEvent) => {
    if (e.key === 'Enter') goTo(item)
  }
})

function goTo(row: Row): void {
  props.nav.goTo({
    key: row.key,
    label: row.change,
    detail: '',
    target: row.position,
    markerKeys: [row.key]
  })
}
</script>

<style scoped>
.track-variant-list :deep(tr) {
  cursor: pointer;
}

.track-variant-list :deep(.track-row--focused) {
  background: rgba(var(--v-theme-primary), 0.1);
}
</style>
