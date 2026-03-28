<template>
  <div class="lollipop-legend d-flex flex-wrap align-center ga-2 pa-2 bg-grey-lighten-4">
    <!-- Consequence category chips (clickable toggle) -->
    <div class="d-flex flex-wrap ga-1 align-center">
      <span class="text-body-2 text-medium-emphasis mr-1 font-weight-medium">Consequence:</span>
      <v-chip
        v-for="[category, color] in consequenceEntries"
        :key="category"
        size="small"
        label
        :variant="isActive(category) ? 'flat' : 'outlined'"
        :style="chipStyle(category, color)"
        class="cursor-pointer"
        @click="toggle(category)"
      >
        {{ formatCategory(category) }}
      </v-chip>
      <v-btn
        v-if="!allActive"
        size="x-small"
        variant="text"
        color="primary"
        class="ml-1 text-none"
        @click="emit('reset-categories')"
      >
        Reset
      </v-btn>
    </div>

    <!-- Domain color indicators -->
    <v-divider v-if="domainTypes.length > 0" vertical class="mx-1" />
    <div v-if="domainTypes.length > 0" class="d-flex flex-wrap ga-1 align-center">
      <span class="text-body-2 text-medium-emphasis mr-1 font-weight-medium">Domains:</span>
      <span
        v-for="[type, color] in domainTypes"
        :key="type"
        class="d-inline-flex align-center ga-1 text-body-2"
      >
        <span class="domain-swatch" :style="{ backgroundColor: color }" />
        {{ type }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ConsequenceCategory, ProteinDomain } from '../../../../shared/types/protein'
import { CONSEQUENCE_COLORS, DOMAIN_TYPE_COLORS } from '../../../../shared/utils/protein-utils'

interface Props {
  activeCategories: Set<ConsequenceCategory>
  domains: ProteinDomain[]
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'toggle-category': [category: ConsequenceCategory]
  'reset-categories': []
}>()

const consequenceEntries = computed(
  () => Object.entries(CONSEQUENCE_COLORS) as [ConsequenceCategory, string][]
)

/** Whether all categories are active */
const allActive = computed(() => props.activeCategories.size === consequenceEntries.value.length)

/** Unique domain types present in the current protein */
const domainTypes = computed(() => {
  const seen = new Set<string>()
  const result: [string, string][] = []
  for (const domain of props.domains) {
    const key = domain.type.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      result.push([domain.type, DOMAIN_TYPE_COLORS[key] ?? '#9E9E9E'])
    }
  }
  return result
})

function isActive(category: ConsequenceCategory): boolean {
  return props.activeCategories.has(category)
}

function toggle(category: ConsequenceCategory): void {
  emit('toggle-category', category)
}

function formatCategory(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1)
}

function chipStyle(category: ConsequenceCategory, color: string): Record<string, string> {
  if (isActive(category)) {
    return { backgroundColor: color, color: '#fff', borderColor: color }
  }
  return { borderColor: color, color, opacity: '0.6' }
}
</script>

<style scoped>
.cursor-pointer {
  cursor: pointer;
}

.domain-swatch {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 2px;
  flex-shrink: 0;
}
</style>
