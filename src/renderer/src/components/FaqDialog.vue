<template>
  <v-dialog v-model="isOpen" max-width="600" scrollable>
    <v-card>
      <v-card-title>Frequently Asked Questions</v-card-title>
      <v-card-text>
        <v-text-field
          v-model="searchInput"
          label="Search questions..."
          prepend-inner-icon="mdi-magnify"
          clearable
          variant="outlined"
          density="compact"
          class="mb-4"
        />

        <template v-if="filteredFaq.length === 0">
          <v-alert
            type="info"
            variant="tonal"
            text="No matching questions found. Try rephrasing your search."
          />
        </template>

        <template v-else>
          <div v-for="(group, category) in groupedFaq" :key="category">
            <div class="text-overline text-medium-emphasis mb-1 mt-3">{{ category }}</div>
            <v-expansion-panels multiple>
              <v-expansion-panel v-for="item in group" :key="item.question">
                <v-expansion-panel-title>{{ item.question }}</v-expansion-panel-title>
                <v-expansion-panel-text>{{ item.answer }}</v-expansion-panel-text>
              </v-expansion-panel>
            </v-expansion-panels>
          </div>
        </template>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn color="primary" variant="flat" @click="isOpen = false">Close</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import faqConfig from '../config/faqConfig.json'
import { useDebounce } from '../composables/useDebounce'

interface FaqItem {
  category: string
  question: string
  answer: string
}

const isOpen = ref(false)
const searchInput = ref('')
const debouncedQuery = ref('')

// Debounce search input
const { debouncedFn: updateQuery } = useDebounce((val: string) => {
  debouncedQuery.value = val
}, 300)

watch(searchInput, (val) => {
  updateQuery(val || '')
})

// Filter FAQ items based on debounced search query
const filteredFaq = computed(() => {
  const query = debouncedQuery.value.toLowerCase().trim()
  if (!query) {
    return faqConfig.items
  }
  return faqConfig.items.filter((item: FaqItem) => {
    return (
      item.question.toLowerCase().includes(query) ||
      item.answer.toLowerCase().includes(query) ||
      item.category.toLowerCase().includes(query)
    )
  })
})

// Group filtered items by category
const groupedFaq = computed(() => {
  const groups: Record<string, FaqItem[]> = {}
  filteredFaq.value.forEach((item: FaqItem) => {
    if (groups[item.category] === undefined) {
      groups[item.category] = []
    }
    groups[item.category].push(item)
  })
  return groups
})

const show = (): void => {
  isOpen.value = true
  searchInput.value = ''
}

defineExpose({ show })
</script>
