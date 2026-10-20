<template>
  <span
    v-if="value"
    class="variant-data-mono transcript-truncated"
    :data-tooltip="value"
    data-tooltip-location="top"
  >
    {{ value }}
  </span>
  <EmptyPlaceholder v-else />
</template>

<script setup lang="ts">
import { EmptyPlaceholder } from '../table-cells'

defineProps<{
  value?: string | null
}>()
</script>

<style scoped>
.variant-data-mono {
  font-family: var(--font-mono);
  font-size: 0.85em;
}

.transcript-truncated {
  max-width: 7.5rem;
  display: inline-block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}
</style>
