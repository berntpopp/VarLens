<template>
  <span v-if="value" class="hgvs-notation" :data-tooltip="value" data-tooltip-location="top">{{
    value
  }}</span>
  <EmptyPlaceholder v-else />
</template>

<script setup lang="ts">
import EmptyPlaceholder from './EmptyPlaceholder.vue'

defineProps<{
  value: string | null | undefined
}>()
</script>
