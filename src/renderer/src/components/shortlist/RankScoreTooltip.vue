<script setup lang="ts">
/**
 * RankScoreTooltip — pure presentational content for the v-tooltip attached
 * to a shortlist row's `rank_score` cell.
 *
 * Shows the total score plus the per-component breakdown
 * (impact / pathogenicity / rarity / clinvar / phenotype) so reviewers can
 * audit WHY a row ranked where it did. When the row was promoted by
 * `clinvarPinTop` or `pinStarredTop`, a "Pinned: ..." footer line is shown.
 *
 * Evidence-ranked rows (`evidence` set) instead list the inheritance mode and
 * each contributing rule with its signed points — they sum to the score —
 * plus a "possible compound heterozygous" note when the row has partners.
 *
 * Stateless: no composable, no IPC. Composition lives in ShortlistPanel
 * (Wave 5).
 *
 * Spec: .planning/specs/2026-04-11-unified-shortlist-ranked-view-design.md (§6)
 */

import { computed } from 'vue'
import type { RankComponents } from '../../../../shared/types/shortlist'
import type { EvidenceContribution } from '../../../../shared/types/evidence-ruleset'
import { formatPoints, formatRankScore } from '../../utils/formatters'

const props = defineProps<{
  score: number
  components: RankComponents
  pinned: 'starred' | 'clinvar' | null
  evidence?: EvidenceContribution[]
  partners?: number[]
}>()

interface Row {
  label: string
  value: string
}

// Computed so the tooltip stays in sync if the component instance is
// reused and the `components` prop changes. A plain const would snapshot
// the values at setup() time and show stale data on prop updates.
const rows = computed<Row[]>(() =>
  props.evidence != null
    ? props.evidence.map((c) => ({ label: c.label, value: formatPoints(c.points) }))
    : [
        { label: 'Impact', value: props.components.impact.toFixed(2) },
        { label: 'Pathogenicity', value: props.components.pathogenicity.toFixed(2) },
        { label: 'Rarity', value: props.components.rarity.toFixed(2) },
        { label: 'ClinVar', value: props.components.clinvar.toFixed(2) },
        { label: 'Phenotype', value: props.components.phenotype.toFixed(2) }
      ]
)

const scoreLine = computed(() =>
  props.evidence != null
    ? `Evidence score: ${formatRankScore({ rank_score: props.score, rank_evidence: props.evidence })}`
    : `Rank score: ${props.score.toFixed(2)}`
)

const partnerCount = computed(() => props.partners?.length ?? 0)

function pinLabel(): string {
  if (props.pinned === 'starred') return 'Pinned: Starred'
  if (props.pinned === 'clinvar') return 'Pinned: ClinVar P/LP'
  return ''
}
</script>

<template>
  <div class="rank-tooltip">
    <div class="rank-tooltip__score">{{ scoreLine }}</div>
    <v-divider class="my-1" />
    <div v-for="(row, i) in rows" :key="i" class="rank-tooltip__row">
      <span class="rank-tooltip__label">{{ row.label }}</span>
      <span class="rank-tooltip__value">{{ row.value }}</span>
    </div>
    <template v-if="evidence != null && partnerCount > 0">
      <v-divider class="my-1" />
      <div class="rank-tooltip__note">
        Possible compound heterozygous (with {{ partnerCount }} other
        {{ partnerCount === 1 ? 'variant' : 'variants' }})
      </div>
    </template>
    <template v-if="pinned !== null">
      <v-divider class="my-1" />
      <div class="rank-tooltip__pin">{{ pinLabel() }}</div>
    </template>
  </div>
</template>

<style scoped>
.rank-tooltip {
  font-size: 0.82rem;
  min-width: 180px;
}
.rank-tooltip__score {
  font-weight: 600;
}
.rank-tooltip__row {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
}
.rank-tooltip__label {
  opacity: 0.75;
}
.rank-tooltip__value {
  font-variant-numeric: tabular-nums;
}
.rank-tooltip__note {
  font-size: 0.78rem;
}
.rank-tooltip__pin {
  font-style: italic;
  font-size: 0.78rem;
}
</style>
