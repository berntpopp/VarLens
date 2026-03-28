<template>
  <div class="lollipop-legend d-flex flex-wrap align-center ga-2 pa-2">
    <!-- Consequence category chips (clickable toggle) -->
    <div class="d-flex flex-wrap ga-1 align-center">
      <span class="text-caption text-medium-emphasis mr-1">Consequence:</span>
      <v-chip
        v-for="[category, color] in consequenceEntries"
        :key="category"
        size="x-small"
        label
        :variant="isActive(category) ? 'flat' : 'outlined'"
        :style="chipStyle(category, color)"
        class="cursor-pointer"
        @click="toggle(category)"
      >
        {{ formatCategory(category) }}
      </v-chip>
    </div>

    <!-- Domain color indicators -->
    <v-divider v-if="domainTypes.length > 0" vertical class="mx-1" />
    <div v-if="domainTypes.length > 0" class="d-flex flex-wrap ga-1 align-center">
      <span class="text-caption text-medium-emphasis mr-1">Domains:</span>
      <span
        v-for="[type, color] in domainTypes"
        :key="type"
        class="d-inline-flex align-center ga-1 text-caption"
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
}>()

const consequenceEntries = computed(
  () => Object.entries(CONSEQUENCE_COLORS) as [ConsequenceCategory, string][]
)

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
  return { borderColor: color, color }
}
</script>

<style scoped>
.cursor-pointer {
  cursor: pointer;
}

.domain-swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  flex-shrink: 0;
}
</style>
