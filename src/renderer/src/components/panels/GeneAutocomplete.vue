<template>
  <v-autocomplete
    v-model="selected"
    :items="items"
    :loading="loadingSuggestions"
    item-title="displayText"
    item-value="symbol"
    density="compact"
    variant="outlined"
    hide-details
    clearable
    no-filter
    return-object
    placeholder="Search gene symbol..."
    :prepend-inner-icon="mdiMagnify"
    @update:search="onSearch"
    @update:model-value="onSelect"
  >
    <template #item="{ props: itemProps, item }">
      <v-list-item v-bind="itemProps" :title="undefined">
        <template #title>
          <span class="font-weight-bold">{{ (item as DisplayItem).symbol }}</span>
          <span class="text-medium-emphasis ml-2">{{ (item as DisplayItem).name }}</span>
        </template>
        <template #subtitle>
          <span class="text-caption">
            {{ (item as DisplayItem).locusGroup }}
            <template v-if="(item as DisplayItem).matchType === 'alias'">
              <span class="text-warning ml-1"
                >(alias: {{ (item as DisplayItem).matchedAlias }})</span
              >
            </template>
          </span>
        </template>
      </v-list-item>
    </template>
  </v-autocomplete>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import { useGeneValidation } from '../../composables/useGeneValidation'
import type { AutocompleteResult } from '../../composables/useGeneValidation'
import { mdiMagnify } from '@mdi/js'

const emit = defineEmits<{
  select: [payload: { symbol: string; hgncId: string; name: string }]
}>()

const { suggestions, loadingSuggestions, autocomplete } = useGeneValidation()

const selected = ref<DisplayItem | null>(null)
let debounceTimer: ReturnType<typeof setTimeout> | null = null

onUnmounted(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
})

interface DisplayItem extends AutocompleteResult {
  displayText: string
  matchedAlias?: string
}

const items = computed<DisplayItem[]>(() =>
  suggestions.value.map((s) => ({
    ...s,
    displayText: s.matchType === 'alias' ? `${s.symbol} (alias match)` : `${s.symbol} - ${s.name}`,
    matchedAlias: s.matchType === 'alias' ? s.matchedAlias : undefined
  }))
)

function onSearch(query: string | null): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (query === null || query === '' || query.length < 2) {
    suggestions.value = []
    return
  }
  debounceTimer = setTimeout(() => {
    autocomplete(query)
  }, 200)
}

function onSelect(item: DisplayItem | null): void {
  if (!item) return
  emit('select', {
    symbol: item.symbol,
    hgncId: item.hgncId,
    name: item.name
  })
  // Clear selection for next input
  selected.value = null
  suggestions.value = []
}
</script>
