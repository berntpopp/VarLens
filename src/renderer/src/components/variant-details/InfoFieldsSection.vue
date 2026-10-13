<script setup lang="ts">
/**
 * The variant's kept annotation fields (`info.<KEY>` in filters), each with
 * the original source field from the case's import field dictionary (#596).
 */
import { computed } from 'vue'
import { infoJsonEntries } from '../../../../shared/utils/case-info-fields'
import { useCaseInfoFields } from '../../composables/useCaseInfoFields'

const props = defineProps<{
  infoJson: string | null | undefined
  caseId: number | null
}>()

const { sourceOf } = useCaseInfoFields(() => props.caseId)
const entries = computed(() => infoJsonEntries(props.infoJson))
</script>

<template>
  <div v-if="entries.length > 0" class="mb-4" data-testid="info-fields-section">
    <h3 class="text-title-small mb-2">Annotation fields</h3>
    <v-list density="compact" bg-color="transparent" class="pa-0">
      <v-list-item v-for="[key, value] in entries" :key="key" class="px-2">
        <template #prepend>
          <span class="text-caption mr-2 info-key">info.{{ key }}</span>
        </template>
        <span class="text-body-small info-value">{{ value }}</span>
        <div v-if="sourceOf(key)" class="text-caption text-medium-emphasis">
          {{ sourceOf(key) }}
        </div>
      </v-list-item>
    </v-list>
  </div>
</template>

<style scoped>
.info-key {
  min-width: 110px;
  font-family: var(--font-mono);
}
.info-value {
  overflow-wrap: anywhere;
}
</style>
