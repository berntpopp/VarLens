<script setup lang="ts">
/**
 * One-line notice above a table whose carrier frequency or carrier cap reads
 * a cohort summary that is being rebuilt (#555): the figures may be out of
 * date until it is current again.
 */
import { mdiDatabaseSync } from '@mdi/js'
import { CARRIER_FREQUENCY_COPY } from '../../config/uiCopyConfig'

defineProps<{ stale: boolean }>()
</script>

<template>
  <div v-if="stale" class="summary-stale-notice text-caption" role="status" aria-live="polite">
    <v-icon :icon="mdiDatabaseSync" size="14" />
    <span>{{ CARRIER_FREQUENCY_COPY.stale }}</span>
  </div>
</template>

<style scoped>
.summary-stale-notice {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px;
  color: rgb(var(--v-theme-info));
}
</style>
