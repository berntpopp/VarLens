<template>
  <v-tooltip v-if="value" location="top">
    <template #activator="{ props: tipProps }">
      <span v-bind="tipProps" class="hgvs-notation">{{ value }}</span>
    </template>
    {{ value }}
  </v-tooltip>
  <EmptyPlaceholder v-else />
</template>

<script setup lang="ts">
import EmptyPlaceholder from './EmptyPlaceholder.vue'

defineProps<{
  value: string | null | undefined
}>()
</script>
