<template>
  <div v-if="chipState !== null" class="d-flex ga-2 align-center py-1">
    <v-chip
      v-if="chipState.kind === 'single'"
      color="info"
      size="small"
      closable
      @click:close="$emit('clear-filter', chipState.typeKey)"
    >
      {{ chipState.label }}
    </v-chip>
    <v-chip v-else color="warning" size="small">
      {{ chipState.label }}
    </v-chip>
  </div>
</template>

<script setup lang="ts">
/**
 * FilterTypeNarrowingChip — visual indicator for active extension-type
 * narrowing in the filter drawer / cohort filter bar.
 *
 * Rendering rules:
 * - No extension filters active → renders nothing
 * - Exactly one extension type (sv/cnv/str) active → info chip
 *   "SV only" / "CNV only" / "STR only" with a close button that emits
 *   `clear-filter` with the type key
 * - Two or more extension types active simultaneously → warning chip
 *   "Combining X + Y filters — results may be empty". This documents the
 *   implicit AND-semantics of the query helpers: a variant cannot have
 *   both `variant_sv` and `variant_cnv` rows, so any cross-type filter
 *   combination will always return zero rows.
 */
import { computed } from 'vue'
import type { ColumnFiltersParam } from '../../../../shared/types/column-filters'
import { VARIANT_EXTENSION_REGISTRY } from '../../../../shared/types/variant-extension-registry-data'

const props = defineProps<{ columnFilters: ColumnFiltersParam }>()

defineEmits<{
  'clear-filter': [typeKey: string]
}>()

type ChipState =
  { kind: 'single'; typeKey: string; label: string } | { kind: 'warning'; label: string }

const chipState = computed<ChipState | null>(() => {
  const typesSeen = new Set<string>()
  for (const key of Object.keys(props.columnFilters)) {
    const dotIdx = key.indexOf('.')
    if (dotIdx === -1) continue
    const typeKey = key.slice(0, dotIdx)
    if (
      VARIANT_EXTENSION_REGISTRY[typeKey as keyof typeof VARIANT_EXTENSION_REGISTRY] !== undefined
    ) {
      typesSeen.add(typeKey)
    }
  }
  if (typesSeen.size === 0) return null
  if (typesSeen.size === 1) {
    const typeKey = [...typesSeen][0]
    const labelMap: Record<string, string> = {
      sv: 'SV only',
      cnv: 'CNV only',
      str: 'STR only'
    }
    return {
      kind: 'single',
      typeKey,
      label: labelMap[typeKey] ?? `${typeKey.toUpperCase()} only`
    }
  }
  const types = [...typesSeen].map((t) => t.toUpperCase()).join(' + ')
  return {
    kind: 'warning',
    label: `Combining ${types} filters — results may be empty`
  }
})
</script>
