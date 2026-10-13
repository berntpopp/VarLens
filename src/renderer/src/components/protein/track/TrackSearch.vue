<template>
  <div class="d-flex align-center ga-1 track-search">
    <v-menu
      :model-value="open"
      :close-on-content-click="true"
      :open-on-click="false"
      location="bottom start"
      @update:model-value="(v) => (open = v)"
    >
      <template #activator="{ props: menu }">
        <v-text-field
          v-bind="menu"
          v-model="query"
          :label="label"
          density="compact"
          variant="outlined"
          hide-details
          single-line
          clearable
          class="track-search-field"
          :data-tooltip="hint"
          data-tooltip-location="bottom"
          :prepend-inner-icon="mdiMagnify"
          role="combobox"
          aria-haspopup="listbox"
          :aria-expanded="open ? 'true' : 'false'"
          :aria-controls="listId"
          :aria-activedescendant="open && matches.length > 0 ? `${listId}-${active}` : undefined"
          @update:model-value="onInput"
          @keydown="onKeydown"
          @click:clear="clear"
          @vue:mounted="dropFieldRole"
        />
      </template>
      <v-list :id="listId" density="compact" role="listbox" class="py-0">
        <v-list-item
          v-for="(m, i) in matches"
          :id="`${listId}-${i}`"
          :key="m.key"
          role="option"
          :aria-selected="i === active"
          :active="i === active"
          @click="choose(i)"
        >
          <v-list-item-title class="text-body-small">{{ m.label }}</v-list-item-title>
          <template #append>
            <span class="text-body-small text-medium-emphasis ml-2">{{ m.detail }}</span>
          </template>
        </v-list-item>
      </v-list>
    </v-menu>
    <IconButton
      v-if="stepping"
      :icon="mdiChevronLeft"
      label="Previous match"
      size="x-small"
      @click="step(-1)"
    />
    <!-- Always mounted, so screen readers hear "No match" and "n of m" as they change. -->
    <span class="text-body-small text-medium-emphasis text-no-wrap" role="status">
      {{ status }}
    </span>
    <IconButton
      v-if="stepping"
      :icon="mdiChevronRight"
      label="Next match"
      size="x-small"
      @click="step(1)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { mdiChevronLeft, mdiChevronRight, mdiMagnify } from '@mdi/js'
import IconButton from '../../common/IconButton.vue'
import { PLOT_COPY } from '../../../config/proteinPlotConfig'
import type { TrackNavigator } from '../../../composables/useTrackNavigator'
import { dropFieldRole } from '../../../utils/combobox-field'
import { parseTrackQuery, searchTrack, type TrackSearchContext } from '../../../utils/track-search'

const props = defineProps<{
  nav: TrackNavigator
  context: TrackSearchContext
  label: string
  /** Accepted inputs (tooltip) */
  hint: string
}>()

const listId = `track-search-${useId()}`
const query = ref<string | null>('')
const open = ref(false)
const active = ref(0)
const chosen = ref<number | null>(null)

const matches = computed(() => searchTrack(parseTrackQuery(query.value ?? ''), props.context))
const stepping = computed(() => chosen.value !== null && matches.value.length > 1)
const status = computed(() => {
  if ((query.value ?? '') !== '' && matches.value.length === 0) return PLOT_COPY.noMatch
  return stepping.value ? `${chosen.value! + 1} of ${matches.value.length}` : ''
})

function onInput(): void {
  active.value = 0
  chosen.value = null
  open.value = matches.value.length > 0
}

function choose(i: number): void {
  const match = matches.value[i]
  if (match === undefined) return
  chosen.value = i
  active.value = i
  open.value = false
  props.nav.goTo(match)
}

function step(d: 1 | -1): void {
  const n = matches.value.length
  choose(((((chosen.value ?? 0) + d) % n) + n) % n)
}

function clear(): void {
  query.value = ''
  chosen.value = null
  open.value = false
  props.nav.highlight([])
}

function onKeydown(e: KeyboardEvent): void {
  const n = matches.value.length
  if (e.key === 'Enter') {
    e.preventDefault()
    choose(open.value || chosen.value === null ? active.value : (chosen.value + 1) % Math.max(1, n))
  } else if (e.key === 'ArrowDown' && n > 0) {
    e.preventDefault()
    open.value = true
    active.value = (active.value + 1) % n
  } else if (e.key === 'ArrowUp' && n > 0) {
    e.preventDefault()
    active.value = (active.value - 1 + n) % n
  } else if (e.key === 'Escape') {
    e.stopPropagation()
    clear()
  }
}
</script>

<style scoped>
.track-search-field {
  width: 280px;
}
</style>
