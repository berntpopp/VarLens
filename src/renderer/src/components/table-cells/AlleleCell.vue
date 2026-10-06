<template>
  <span
    v-if="isTruncated"
    class="text-truncate allele-cell variant-data-mono"
    :data-tooltip="allele"
    data-tooltip-location="top"
  >
    {{ truncatedValue }}
  </span>
  <span v-else class="variant-data-mono">{{ allele }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface AlleleCellProps {
  allele: string
  maxLength?: number
}

const props = withDefaults(defineProps<AlleleCellProps>(), {
  maxLength: 20
})

const isTruncated = computed(() => props.allele.length > props.maxLength)
const truncatedValue = computed(() => {
  if (!isTruncated.value) return props.allele
  return `${props.allele.substring(0, props.maxLength)}...`
})
</script>
