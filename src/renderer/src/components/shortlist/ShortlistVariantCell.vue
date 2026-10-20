<script setup lang="ts">
import type { VariantCell } from './shortlist-table-helpers'

defineProps<{
  cell: VariantCell
}>()
</script>

<template>
  <div class="variant-cell">
    <div class="variant-cell__primary">{{ cell.primary }}</div>
    <div
      v-if="cell.cdna"
      class="variant-cell__hgvs text-caption text-medium-emphasis"
      :title="cell.cdna ?? ''"
    >
      {{ cell.cdna }}
    </div>
    <div
      v-if="cell.protein"
      class="variant-cell__hgvs text-caption text-medium-emphasis"
      :title="cell.protein ?? ''"
    >
      {{ cell.protein }}
    </div>
  </div>
</template>

<style scoped>
.variant-cell {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.25;
  padding: 2px 0;
}
.variant-cell__primary {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.variant-cell__hgvs {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--font-mono);
}
</style>
