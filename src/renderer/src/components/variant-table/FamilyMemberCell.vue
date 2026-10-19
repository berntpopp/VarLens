<template>
  <span
    v-if="call?.gt_num != null"
    :title="formatFamilyCallMeta(call)"
    data-testid="family-member-call"
  >
    <v-chip size="x-small" :color="zygosityColor(call.gt_num)" label>
      {{ call.gt_num }}
    </v-chip>
    <span v-if="formatFamilyCallMeta(call)" class="text-caption text-medium-emphasis ml-1">
      {{ formatFamilyCallMeta(call) }}
    </span>
  </span>
  <EmptyPlaceholder v-else />
</template>

<script setup lang="ts">
import { formatFamilyCallMeta, zygosityColor } from './columns'
import { EmptyPlaceholder } from '../table-cells'

defineProps<{
  call?: { gt_num?: string | null; [key: string]: unknown } | null
}>()
</script>
