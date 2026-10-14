<template>
  <div>
    <!-- Assigned terms: present and excluded rows (spec 2026-10-14 §4). Chips are menu
         buttons (status + remove), so no nested close button (axe nested-interactive). -->
    <template v-if="modelValue.length > 0">
      <div
        v-for="group in groups"
        :key="group.name"
        role="group"
        :aria-label="group.label"
        class="d-flex flex-wrap align-center ga-1 mb-2"
        :data-testid="`hpo-group-${group.name}`"
      >
        <span class="hpo-group-label text-caption text-medium-emphasis">{{ group.title }}</span>
        <v-menu
          v-for="term in group.terms"
          :key="term.hpo_id"
          location="bottom start"
          :disabled="disabled"
        >
          <template #activator="{ props: menuProps }">
            <v-chip
              v-bind="menuProps"
              role="button"
              size="small"
              :color="term.excluded ? 'error' : 'info'"
              variant="tonal"
              :prepend-icon="hpoTermIcon(term)"
              :class="{ 'font-weight-bold': term.key }"
              :disabled="disabled"
              :aria-label="hpoTermAriaLabel(term)"
              aria-keyshortcuts="x k Delete"
              :data-testid="`hpo-chip-${term.hpo_id}`"
              @keydown="onChipKeydown($event, term)"
            >
              <HpoTermText :term="term" />
              <v-tooltip activator="parent" location="top">
                {{ term.hpo_id }} - {{ term.hpo_label }} · {{ COPY.chipShortcuts }}
              </v-tooltip>
            </v-chip>
          </template>
          <v-list density="compact" :aria-label="COPY.menuLabel(term.hpo_label)">
            <v-list-item
              :active="!term.excluded"
              :prepend-icon="mdiPlusCircleOutline"
              :title="COPY.present"
              @click="update(term, { excluded: false, key: term.key })"
            />
            <v-list-item
              :active="term.excluded"
              :prepend-icon="mdiMinusCircleOutline"
              :title="COPY.excludedMenu"
              @click="update(term, { excluded: true, key: false })"
            />
            <v-list-item
              :active="term.key"
              :disabled="term.excluded"
              :prepend-icon="term.key ? mdiStar : mdiStarOutline"
              :title="COPY.key"
              @click="update(term, { excluded: false, key: !term.key })"
            />
            <v-list-item :prepend-icon="mdiClose" :title="COPY.remove" @click="remove(term)" />
          </v-list>
        </v-menu>
      </div>
    </template>
    <div v-else class="text-muted text-body-medium mb-2">{{ COPY.empty }}</div>

    <!-- Capability off (e.g. the document has not loaded): say so instead of "No matching terms" -->
    <div
      v-if="hpoUnavailableReason !== null"
      class="text-body-medium text-medium-emphasis"
      role="note"
      data-testid="hpo-search-unavailable"
    >
      {{ hpoUnavailableReason }}
    </div>

    <!-- Autocomplete for adding new terms -->
    <v-autocomplete
      v-else
      ref="searchField"
      v-model="selectedTerm"
      v-model:search="searchQuery"
      :items="searchResults"
      :loading="loading"
      item-title="name"
      item-value="id"
      return-object
      density="compact"
      variant="outlined"
      hide-details
      clearable
      auto-select-first
      :disabled="disabled || !hpoApiAvailable"
      label="Search HPO terms"
      :placeholder="COPY.placeholder"
      aria-keyshortcuts="Enter Shift+Enter"
      :list-props="HPO_LIST_PROPS"
      data-testid="hpo-term-search"
      no-filter
      @keydown.capture="rememberShift"
      @update:model-value="handleTermSelected"
    >
      <template #item="{ item, props: itemProps }">
        <v-list-item v-bind="itemProps">
          <template #subtitle>
            {{ item.id }}
          </template>
        </v-list-item>
      </template>
      <template #no-data>
        <v-list-item v-if="searchError">
          <v-list-item-title class="text-error">{{ searchError }}</v-list-item-title>
        </v-list-item>
        <v-list-item v-else-if="searchQuery && searchQuery.length >= 2 && !loading">
          <v-list-item-title class="text-muted">No matching HPO terms</v-list-item-title>
        </v-list-item>
        <v-list-item v-else-if="searchQuery && searchQuery.length < 2">
          <v-list-item-title class="text-muted">Type at least 2 characters</v-list-item-title>
        </v-list-item>
      </template>
    </v-autocomplete>
  </div>
</template>

<script setup lang="ts">
import HpoTermText from './HpoTermText.vue'
import { computed, nextTick, ref, watch, onMounted } from 'vue'
import {
  mdiClose,
  mdiMinusCircleOutline,
  mdiPlusCircleOutline,
  mdiStar,
  mdiStarOutline
} from '@mdi/js'
import { useDebounce } from '../composables/useDebounce'
import { useHpoBundled } from '../composables/useHpoBundled'
import type { CaseHpoTerm } from '../../../shared/types/api'
import { runtimeFeatureUnavailableReason } from '../utils/runtime-features'
import { hpoTermAriaLabel, hpoTermIcon, type HpoTermChange } from '../utils/hpo-term-status'
import { HPO_TERM_COPY as COPY } from '../config/hpoTermCopy'

interface HpoSearchResult {
  id: string
  name: string
}

const props = defineProps<{
  modelValue: CaseHpoTerm[]
  disabled?: boolean
}>()

const emit = defineEmits<{
  'add:term': [term: HpoTermChange]
  'update:term': [term: HpoTermChange]
  'remove:term': [hpoId: string]
}>()

const groups = computed(() =>
  [
    {
      name: 'present',
      title: COPY.present,
      label: COPY.presentGroup,
      terms: props.modelValue.filter((t) => !t.excluded)
    },
    {
      name: 'excluded',
      title: COPY.excluded,
      label: COPY.excludedGroup,
      terms: props.modelValue.filter((t) => t.excluded)
    }
  ].filter((g) => g.terms.length > 0)
)

const searchField = ref<{ focus: () => void } | null>(null)
/** Focus goes back to the search input after every change (the chip may re-render). */
function refocusInput(): void {
  void nextTick(() => searchField.value?.focus())
}

function update(term: CaseHpoTerm, flags: { excluded: boolean; key: boolean }): void {
  if (flags.excluded !== term.excluded || flags.key !== term.key)
    emit('update:term', { hpoId: term.hpo_id, hpoLabel: term.hpo_label, ...flags })
  refocusInput()
}

function remove(term: CaseHpoTerm): void {
  emit('remove:term', term.hpo_id)
  refocusInput()
}

function onChipKeydown(event: KeyboardEvent, term: CaseHpoTerm): void {
  if (props.disabled === true || event.ctrlKey || event.metaKey || event.altKey) return
  const key = event.key.toLowerCase()
  if (key === 'x') update(term, { excluded: !term.excluded, key: false })
  else if (key === 'k' && !term.excluded) update(term, { excluded: false, key: !term.key })
  else if (event.key === 'Delete' || event.key === 'Backspace') remove(term)
  else return
  event.preventDefault()
}

/** Shift on the Enter / click that picks a suggestion adds the term as excluded. */
let addAsExcluded = false
function rememberShift(event: KeyboardEvent | MouseEvent): void {
  if (!(event instanceof KeyboardEvent)) {
    addAsExcluded = event.shiftKey
    return
  }
  addAsExcluded = event.key === 'Enter' && event.shiftKey
  // Tab only moves focus: kept from VAutocomplete, whose auto-select-first would pick a term.
  if (event.key === 'Tab') event.stopPropagation()
}

// The bundled term list: works offline, on desktop and web alike.
const { search: searchBundledTerms, loadError } = useHpoBundled()

/** Name the suggestion listbox and make its scroll region keyboard-reachable (axe). */
const HPO_LIST_PROPS: Record<string, unknown> = {
  'aria-label': 'Matching HPO terms',
  tabindex: 0,
  // List items turn Enter into a click that keeps shiftKey, so one capture covers both.
  onClickCapture: (event: MouseEvent) => rememberShift(event)
}

const searchQuery = ref('')
const searchResults = ref<HpoSearchResult[]>([])
const loading = ref(false)
const selectedTerm = ref<HpoSearchResult | null>(null)
const hpoUnavailableReason = runtimeFeatureUnavailableReason('hpoSearch')
const hpoApiAvailable = ref(false)
/** Search failure (as opposed to "no matches") shown in the dropdown. */
const searchError = ref('')

onMounted(() => {
  // Availability comes from the capability document, not `typeof` detection.
  hpoApiAvailable.value = hpoUnavailableReason === null
})

// Search function for debouncing
async function performSearch(query: string) {
  // Stale: the search moved on (e.g. cleared after an add) while this call was debounced.
  if (query !== searchQuery.value) return
  if (!hpoApiAvailable.value || query.length < 2) {
    searchResults.value = []
    return
  }

  loading.value = true
  searchError.value = ''
  try {
    const terms = await searchBundledTerms(query, 20)
    if (query !== searchQuery.value) return
    // Filter out already assigned terms
    const assignedIds = new Set(props.modelValue.map((t) => t.hpo_id))
    searchResults.value = terms.filter((t) => !assignedIds.has(t.id))
    // The composable logs a failed load of the list and returns no terms.
    if (loadError.value !== null) searchError.value = 'HPO search failed. Try again later.'
  } finally {
    loading.value = false
  }
}

// Use correct useDebounce destructuring pattern
const { debouncedFn: debouncedSearch } = useDebounce(performSearch, 300)

watch(searchQuery, (query) => {
  if (query && query.length >= 2) {
    debouncedSearch(query)
  } else {
    searchResults.value = []
  }
})

function handleTermSelected(term: HpoSearchResult | null) {
  const excluded = addAsExcluded
  addAsExcluded = false
  if (term) {
    emit('add:term', { hpoId: term.id, hpoLabel: term.name, excluded, key: false })
    // Clear after adding; the autocomplete writes the picked title into the search
    // right after this emit, so the search is cleared on the next tick.
    selectedTerm.value = null
    searchResults.value = []
    void nextTick(() => {
      searchQuery.value = ''
      searchField.value?.focus()
    })
  }
}
</script>

<style scoped>
.hpo-group-label {
  min-width: 4.5rem;
}
</style>
