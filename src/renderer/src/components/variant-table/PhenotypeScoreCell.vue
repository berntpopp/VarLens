<script setup lang="ts">
/**
 * Phenotype column cell: the stored score and the best disease, "—" without a
 * score. The explanation tooltip is mounted on the first hover or focus only,
 * and its explanation fetched once per case and gene (usePhenotypeColumn.ts).
 */
import { ref } from 'vue'
import type { HpoExplanation } from '../../../../shared/types/hpo-profile'
import { EmptyPlaceholder } from '../table-cells'
import PhenotypeExplanation from '../shortlist/PhenotypeExplanation.vue'
import { explainPhenotype } from './usePhenotypeColumn'

const props = defineProps<{
  /** null in the cohort view: no explanation (several carriers, each with own terms) */
  caseId: number | null
  row: {
    gene_symbol?: string | null
    phenotype_score?: number | null
    phenotype_disease?: string | null
  }
}>()

const armed = ref(false)
const open = ref(false)
const explanation = ref<HpoExplanation | null | undefined>(undefined)

function arm(): void {
  const gene = props.row.gene_symbol
  if (armed.value || props.caseId === null || gene == null) return
  armed.value = true
  open.value = true
  explainPhenotype(props.caseId, gene).then(
    (e) => (explanation.value = e),
    () => (explanation.value = null)
  )
}
</script>

<!-- An empty data-tooltip opts out of the app-wide truncated-cell tooltip: the explanation
     tooltip already carries the full disease label. -->
<template>
  <EmptyPlaceholder v-if="row.phenotype_score == null" />
  <span
    v-else
    class="phenotype-cell"
    :tabindex="caseId === null ? undefined : 0"
    :data-tooltip="caseId === null ? undefined : ''"
    @mouseenter="arm"
    @focusin="arm"
  >
    <span class="phenotype-cell__score">{{ row.phenotype_score.toFixed(2) }}</span>
    <span v-if="row.phenotype_disease" class="phenotype-cell__disease">{{
      row.phenotype_disease
    }}</span>
    <v-tooltip v-if="armed" v-model="open" activator="parent" location="left" max-width="420">
      <div class="phenotype-cell__tip" data-testid="phenotype-tooltip">
        <PhenotypeExplanation v-if="explanation" :hpo="explanation" />
        <div v-else-if="explanation === null">No explanation available</div>
        <div v-else>Loading explanation…</div>
      </div>
    </v-tooltip>
  </span>
</template>

<style scoped>
.phenotype-cell {
  display: flex;
  gap: 0.375rem;
  min-width: 0;
}
.phenotype-cell__score {
  font-variant-numeric: tabular-nums;
  flex: none;
}
.phenotype-cell__disease {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.75;
}
.phenotype-cell__tip {
  font-size: 0.78rem;
}
</style>
