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
    <div v-else class="text-grey text-body-medium mb-2">No phenotype terms assigned</div>

    <!-- Autocomplete for adding new terms -->
    <v-autocomplete
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
      :placeholder="hpoApiAvailable ? 'Search HPO terms...' : 'HPO search unavailable'"
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
        <v-list-item v-if="!hpoApiAvailable">
          <v-list-item-title class="text-grey"
            >HPO search unavailable - complete Phase 21</v-list-item-title
          >
        </v-list-item>
        <v-list-item v-else-if="searchQuery && searchQuery.length >= 2 && !loading">
          <v-list-item-title class="text-grey">No matching HPO terms</v-list-item-title>
        </v-list-item>
        <v-list-item v-else-if="searchQuery && searchQuery.length < 2">
          <v-list-item-title class="text-grey">Type at least 2 characters</v-list-item-title>
        </v-list-item>
      </template>
    </v-autocomplete>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useDebounce } from '../composables/useDebounce'
import { useApiService } from '../composables/useApiService'
import type { CaseHpoTerm } from '../../../shared/types/api'

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

const { api } = useApiService()

const searchQuery = ref('')
const searchResults = ref<HpoSearchResult[]>([])
const loading = ref(false)
const selectedTerm = ref<HpoSearchResult | null>(null)
const hpoApiAvailable = ref(false)

// Check if HPO API is available (Phase 21 complete)
onMounted(() => {
  hpoApiAvailable.value =
    api != null && typeof api.hpo !== 'undefined' && typeof api.hpo.search === 'function'
})

// Search function for debouncing
async function performSearch(query: string) {
  if (!hpoApiAvailable.value || query.length < 2) {
    searchResults.value = []
    return
  }

  loading.value = true
  try {
    const result = await api!.hpo.search(query, 20)
    if (result.success) {
      // Filter out already assigned terms
      const assignedIds = new Set(props.modelValue.map((t) => t.hpo_id))
      searchResults.value = result.terms.filter((t) => !assignedIds.has(t.id))
    } else {
      searchResults.value = []
    }
  } catch (error) {
    // eslint-disable-next-line no-undef
    console.error('HPO search failed:', error)
    searchResults.value = []
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
