<template>
  <div class="mt-4">
    <div class="text-body-medium mb-2" data-testid="batch-progress-headline">
      <template v-if="completedFiles !== undefined">
        {{ completedFiles }} of {{ totalFiles }} files done
      </template>
      <template v-else>
        Importing {{ currentFileName }} ({{ currentIndex + 1 }} of {{ totalFiles }})
      </template>
    </div>
    <v-progress-linear :model-value="overallPercent" color="primary" height="25" class="mb-2">
      <template #default>{{ overallPercent }}%</template>
    </v-progress-linear>
    <ul
      v-if="running.length > 0"
      class="batch-in-flight text-body-small"
      aria-label="Files importing now"
    >
      <li
        v-for="file in running"
        :key="file.index"
        class="d-flex ga-3 py-1"
        data-testid="batch-in-flight-file"
      >
        <span class="text-truncate flex-grow-1" :title="file.fileName">{{ file.fileName }}</span>
        <span class="text-medium-emphasis flex-shrink-0">
          {{ importPhaseLabel(file.phase)
          }}<template v-if="file.count > 0"> · {{ file.count.toLocaleString() }} variants</template>
        </span>
      </li>
    </ul>
    <div v-else-if="completedFiles === undefined && variantCount > 0" class="text-body-small">
      Variants processed: {{ variantCount.toLocaleString() }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { BatchFileInFlight } from '../../../../shared/types/api'
import { importPhaseLabel } from '../../composables/useBackgroundJobs'

const props = defineProps<{
  currentFileName: string
  currentIndex: number
  totalFiles: number
  overallPercent: number
  variantCount: number
  /** Files finished so far; absent when the backend imports one file at a time. */
  completedFiles?: number
  /** Files being imported right now, with their phase and variant count. */
  inFlight?: BatchFileInFlight[]
}>()

const running = computed(() => props.inFlight ?? [])
</script>

<style scoped>
.batch-in-flight {
  list-style: none;
  padding: 0;
  margin: 0;
  font-variant-numeric: tabular-nums;
}
</style>
