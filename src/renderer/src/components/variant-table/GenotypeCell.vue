<template>
  <template v-if="value !== null && value !== undefined">
    <v-chip size="x-small" :color="zygosityColor(value)" label>{{ value }}</v-chip>
    <v-chip
      v-if="phase"
      size="x-small"
      label
      :color="COMPHET_PHASE_COLORS[phase]"
      :title="COMPHET_PHASE_LABELS[phase]"
      class="ml-1"
      data-testid="comphet-phase-chip"
    >
      {{ phase }}
    </v-chip>
  </template>
  <EmptyPlaceholder v-else />
</template>

<script setup lang="ts">
import {
  COMPHET_PHASE_COLORS,
  COMPHET_PHASE_LABELS,
  type CompHetPhase
} from '../../../../shared/utils/phasing'
import { zygosityColor } from './columns'
import { EmptyPlaceholder } from '../table-cells'

// `phase` is its own prop: pooled render rows are mutated in place, so an `item`
// prop would keep the same identity and never re-render the chip.
defineProps<{
  value: string | null | undefined
  phase: CompHetPhase | null | undefined
}>()
</script>
