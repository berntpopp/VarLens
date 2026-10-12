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
          :aria-expanded="open ? 'true' : 'false'"
          :aria-controls="listId"
          :aria-activedescendant="open && matches.length > 0 ? `${listId}-${active}` : undefined"
          @update:model-value="onInput"
          @keydown="onKeydown"
          @click:clear="clear"
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
    <span v-if="query && matches.length === 0" class="text-body-small text-medium-emphasis">
      {{ PLOT_COPY.noMatch }}
    </span>
    <template v-else-if="chosen !== null && matches.length > 1">
      <IconButton :icon="mdiChevronLeft" label="Previous match" size="x-small" @click="step(-1)" />
      <span class="text-body-small text-no-wrap" aria-live="polite">
        {{ chosen + 1 }} of {{ matches.length }}
      </span>
      <IconButton :icon="mdiChevronRight" label="Next match" size="x-small" @click="step(1)" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { mdiChevronLeft, mdiChevronRight, mdiMagnify } from '@mdi/js'
import IconButton from '../../common/IconButton.vue'
import { PLOT_COPY } from '../../../config/proteinPlotConfig'
import type { TrackNavigator } from '../../../composables/useTrackNavigator'
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
