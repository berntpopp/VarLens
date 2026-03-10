<template>
  <div class="mt-4">
    <div class="text-body-medium mb-2">
      Importing {{ currentFileName }} ({{ currentIndex + 1 }} of {{ totalFiles }})
    </div>
    <v-progress-linear :model-value="overallPercent" color="primary" height="25" class="mb-2">
      <template #default>{{ overallPercent }}%</template>
    </v-progress-linear>
    <div v-if="variantCount > 0" class="text-body-small">
      Variants processed: {{ variantCount.toLocaleString() }}
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  currentFileName: string
  currentIndex: number
  totalFiles: number
  overallPercent: number
  variantCount: number
}>()
</script>
