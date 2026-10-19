<template>
  <template v-if="value !== null && value !== undefined">
    <v-chip size="x-small" :color="zygosityColor(value)" label>{{ value }}</v-chip>
    <v-chip
      v-if="item.comphet_phase"
      size="x-small"
      label
      :color="COMPHET_PHASE_COLORS[item.comphet_phase]"
      :title="COMPHET_PHASE_LABELS[item.comphet_phase]"
      class="ml-1"
      data-testid="comphet-phase-chip"
    >
      {{ item.comphet_phase }}
    </v-chip>
  </template>
  <EmptyPlaceholder v-else />
</template>

<script setup lang="ts">
import type { Variant } from '../../../../shared/types/api'
import { COMPHET_PHASE_COLORS, COMPHET_PHASE_LABELS } from '../../../../shared/utils/phasing'
import { zygosityColor } from './columns'
import { EmptyPlaceholder } from '../table-cells'

defineProps<{
  item: Variant
  value: string | null | undefined
}>()
</script>
