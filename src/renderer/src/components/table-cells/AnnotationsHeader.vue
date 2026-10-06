<template>
  <!-- Header for the star / ACMG / comment column: icon for sighted users,
       real header text for assistive tech (axe: empty-table-header). -->
  <span
    class="d-inline-flex align-center"
    data-tooltip="Annotations: star, ACMG classification, comment"
  >
    <v-icon :icon="mdiStar" size="x-small" color="muted" aria-hidden="true" />
    <span class="visually-hidden">Annotations</span>
  </span>
</template>

<script setup lang="ts">
import { mdiStar } from '@mdi/js'
</script>
