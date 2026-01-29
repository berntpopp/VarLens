<template>
  <v-autocomplete
    v-model="selectedTerm"
    v-model:search="searchQuery"
    :items="searchResults"
    :loading="isSearching"
    :disabled="disabled"
    item-title="displayText"
    item-value="id"
    return-object
    density="compact"
    variant="outlined"
    hide-details
    clearable
    :placeholder="placeholder"
    :label="label"
    no-filter
    @update:model-value="handleSelection"
  >
    <template #item="{ item, props: itemProps }">
      <v-list-item v-bind="itemProps" :title="undefined" :subtitle="undefined">
        <v-list-item-title class="text-body-2">
          <span class="text-primary font-weight-medium">{{ item.raw.id }}</span>
          <span class="mx-1">-</span>
          <span>{{ item.raw.name }}</span>
        </v-list-item-title>
      </v-list-item>
    </template>
    <template #no-data>
      <v-list-item v-if="searchQuery.length < 2">
        <v-list-item-title class="text-caption text-grey">
          Type at least 2 characters to search
        </v-list-item-title>
      </v-list-item>
      <v-list-item v-else-if="isSearching">
        <v-list-item-title class="text-caption text-grey"> Searching... </v-list-item-title>
      </v-list-item>
      <v-list-item v-else-if="loadError">
        <v-list-item-title class="text-caption text-error">
          {{ loadError }}
        </v-list-item-title>
      </v-list-item>
      <v-list-item v-else>
        <v-list-item-title class="text-caption text-grey">
          No matching HPO terms
        </v-list-item-title>
      </v-list-item>
    </template>
  </v-autocomplete>
</template>

<script setup lang="ts">
/* global console */
import { ref, computed, watch } from 'vue'
import { useHpoBundled, type HpoTerm } from '../composables/useHpoBundled'
import { useDebounce } from '../composables/useDebounce'

interface DisplayHpoTerm extends HpoTerm {
  displayText: string
}

interface Props {
  /** Optional label for the autocomplete */
  label?: string
  /** Placeholder text */
  placeholder?: string
  /** Maximum results to show */
  maxResults?: number
  /** Disabled state */
  disabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  label: undefined,
  placeholder: 'Search HPO terms...',
  maxResults: 20,
  disabled: false
})

interface Emits {
  (e: 'select', term: HpoTerm): void
}

const emit = defineEmits<Emits>()

const { search, isLoading, loadError } = useHpoBundled()

const searchQuery = ref('')
const searchResults = ref<DisplayHpoTerm[]>([])
const selectedTerm = ref<DisplayHpoTerm | null>(null)
const isSearching = computed(() => isLoading.value)

// Perform search
const performSearch = async (query: string) => {
  if (!query || query.length < 2) {
    searchResults.value = []
    return
  }

  try {
    const results = await search(query, props.maxResults)
    // Add display text for autocomplete
    searchResults.value = results.map((term) => ({
      ...term,
      displayText: `${term.id} - ${term.name}`
    }))
  } catch (error) {
    console.error('HPO search failed:', error)
    searchResults.value = []
  }
}

// Create debounced search
const { debouncedFn: debouncedSearch } = useDebounce(performSearch, 300)

// Watch search query and trigger debounced search
watch(searchQuery, (query) => {
  debouncedSearch(query)
})

// Handle selection
const handleSelection = (term: DisplayHpoTerm | null) => {
  if (term) {
    emit('select', { id: term.id, name: term.name })
    // Clear selection after emitting
    selectedTerm.value = null
    searchQuery.value = ''
    searchResults.value = []
  }
}
</script>
