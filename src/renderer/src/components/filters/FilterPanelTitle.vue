<template>
  <v-expansion-panel-title>
    <div class="d-flex align-center justify-space-between w-100">
      <div class="d-flex align-center">
        <v-icon size="small" class="mr-2">{{ icon }}</v-icon>
        <span class="text-title-small font-weight-medium">{{ label }}</span>
        <v-chip v-if="active" size="x-small" color="primary" class="ml-2" label> Active </v-chip>
      </div>
      <!-- Collapsed value preview -->
      <span
        v-if="active && valueSummary"
        class="filter-value-summary text-caption text-medium-emphasis"
      >
        {{ valueSummary }}
      </span>
    </div>
  </v-expansion-panel-title>
</template>

<script setup lang="ts">
defineProps<{
  icon: string
  label: string
  active: boolean
  /** Short summary shown when panel is collapsed and filter is active */
  valueSummary?: string
}>()
</script>
