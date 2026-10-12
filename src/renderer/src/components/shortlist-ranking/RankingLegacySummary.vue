<script setup lang="ts">
/** Read-only summary of a weighted (non-evidence) shortlist preset: its candidate gate and size. */
import { computed } from 'vue'
import { shortlistConfigOf } from '../../composables/useShortlistRankingEditor'
import { SHORTLIST_RANKING_EDITOR as COPY } from '../../config/shortlistRankingEditor'
import type { FilterPreset } from '../../../../shared/types/filter-presets'

const props = defineProps<{ preset: FilterPreset }>()

const orDash = (text: string | undefined): string =>
  text === undefined || text === '' ? '—' : text

const rows = computed(() => {
  const config = shortlistConfigOf(props.preset)
  if (config === null) return []
  const f = config.baseFilters
  return [
    { label: COPY.fields.maxGnomadAf, value: f.maxGnomadAf ?? '—' },
    { label: COPY.fields.impacts, value: orDash(f.consequences?.join(', ')) },
    {
      label: COPY.fields.variantTypes,
      value: orDash((config.variantTypeScope ?? []).map((t) => t.toUpperCase()).join(', '))
    },
    { label: COPY.fields.topN, value: config.topN }
  ]
})
</script>

<template>
  <dl class="legacy-summary">
    <template v-for="row in rows" :key="row.label">
      <dt>{{ row.label }}</dt>
      <dd>{{ row.value }}</dd>
    </template>
  </dl>
</template>

<style scoped>
.legacy-summary {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 2px 16px;
  margin: 8px 0;
  font-size: 0.8125rem;
}
.legacy-summary dt {
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}
.legacy-summary dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}
</style>
