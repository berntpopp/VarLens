<template>
  <v-chip
    v-if="asChip && hasValue"
    :color="chipColor"
    size="small"
    label
    :data-tooltip="consequence"
    data-tooltip-location="top"
  >
    {{ displayValue }}
  </v-chip>
  <span v-else-if="hasValue" :data-tooltip="consequence" data-tooltip-location="top">{{
    displayValue
  }}</span>
  <span v-else>--</span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { getImpactColor } from '../../composables/useTableColors'

interface ConsequenceCellProps {
  consequence: string | null
  impact?: string | null
  asChip?: boolean
}

const props = withDefaults(defineProps<ConsequenceCellProps>(), {
  impact: null,
  asChip: false
})

const hasValue = computed(
  () => props.consequence !== null && props.consequence !== undefined && props.consequence !== ''
)
const displayValue = computed(() => props.consequence?.replace(/_/g, ' ') ?? '--')
const chipColor = computed(() => {
  if (props.impact !== null && props.impact !== '') {
    return getImpactColor(props.impact)
  }
  return 'grey'
})
</script>
