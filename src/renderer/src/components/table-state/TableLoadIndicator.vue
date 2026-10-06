<script setup lang="ts">
/**
 * Refetch indicator for data tables: a thin, absolutely positioned progress
 * bar (no layout shift) plus a polite live region announcing the result
 * count once a load settles. Driven by useTableLoadingState.
 */
defineProps<{
  /** Delayed refetch flag (useTableLoadingState.showStale). */
  active: boolean
  /** Live-region text, e.g. "6,399 variants". */
  message: string
}>()
</script>

<template>
  <div class="table-load-indicator">
    <v-progress-linear
      :active="active"
      indeterminate
      height="2"
      color="primary"
      class="table-load-indicator__bar"
      aria-hidden="true"
    />
    <div class="table-load-indicator__live" role="status" aria-live="polite" aria-atomic="true">
      {{ message }}
    </div>
  </div>
</template>

<style scoped>
.table-load-indicator {
  position: absolute;
  inset: 0 0 auto;
  height: 2px;
  z-index: 5;
  pointer-events: none;
}

.table-load-indicator__live {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
