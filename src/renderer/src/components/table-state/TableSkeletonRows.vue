<script setup lang="ts">
/**
 * First-load skeleton for v-data-table `#loading`. Rows use the table's own
 * row height (--v-table-row-height) so the swap to real rows does not move
 * the footer or the page.
 */
withDefaults(defineProps<{ rows?: number }>(), { rows: 10 })
</script>

<template>
  <div class="table-skeleton" aria-hidden="true">
    <div v-for="n in rows" :key="n" class="table-skeleton__row">
      <span class="table-skeleton__bar" />
    </div>
  </div>
</template>

<style scoped>
.table-skeleton__row {
  display: flex;
  align-items: center;
  height: var(--v-table-row-height, 36px);
  padding: 0 16px;
  border-bottom: thin solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.table-skeleton__bar {
  display: block;
  width: 100%;
  height: 10px;
  border-radius: 4px;
  background: color-mix(in srgb, rgb(var(--v-theme-on-surface)) 8%, transparent);
}

@media (prefers-reduced-motion: no-preference) {
  .table-skeleton__bar {
    animation: table-skeleton-pulse 1.2s ease-in-out infinite;
  }
}

@keyframes table-skeleton-pulse {
  50% {
    opacity: 0.5;
  }
}
</style>
