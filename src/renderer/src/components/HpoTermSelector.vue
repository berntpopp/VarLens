<template>
  <div>
    <!-- Display assigned terms as chips -->
    <div v-if="modelValue.length > 0" class="d-flex flex-wrap ga-1 mb-2">
      <v-chip
        v-for="term in modelValue"
        :key="term.hpo_id"
        closable
        size="small"
        color="info"
        variant="tonal"
        :disabled="disabled"
        @click:close="$emit('remove:term', term.hpo_id)"
      >
        {{ term.hpo_label }}
        <v-tooltip activator="parent" location="top">
          {{ term.hpo_id }} - {{ term.hpo_label }}
        </v-tooltip>
      </v-chip>
    </div>
    <div v-else class="text-muted text-body-medium mb-2">No phenotype terms assigned</div>

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
      :disabled="disabled || !hpoApiAvailable"
      label="Search HPO terms"
      placeholder="Type a term or HPO ID"
      :list-props="HPO_LIST_PROPS"
      data-testid="hpo-term-search"
      no-filter
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
import { ref, watch, onMounted } from 'vue'
import { useDebounce } from '../composables/useDebounce'
import { useHpoBundled } from '../composables/useHpoBundled'
import type { CaseHpoTerm } from '../../../shared/types/api'
import { runtimeFeatureUnavailableReason } from '../utils/runtime-features'

interface HpoSearchResult {
  id: string
  name: string
}

const props = defineProps<{
  modelValue: CaseHpoTerm[]
  disabled?: boolean
}>()

const emit = defineEmits<{
  'add:term': [term: { hpoId: string; hpoLabel: string }]
  'remove:term': [hpoId: string]
}>()

// The bundled term list: works offline, on desktop and web alike.
const { search: searchBundledTerms, loadError } = useHpoBundled()

/** Name the suggestion listbox and make its scroll region keyboard-reachable (axe). */
const HPO_LIST_PROPS: Record<string, unknown> = { 'aria-label': 'Matching HPO terms', tabindex: 0 }

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
  if (!hpoApiAvailable.value || query.length < 2) {
    searchResults.value = []
    return
  }

  loading.value = true
  searchError.value = ''
  try {
    const terms = await searchBundledTerms(query, 20)
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
  if (term) {
    emit('add:term', { hpoId: term.id, hpoLabel: term.name })
    // Clear selection and search after adding
    selectedTerm.value = null
    searchQuery.value = ''
    searchResults.value = []
  }
}
</script>
