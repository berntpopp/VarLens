<template>
  <!-- Mini lollipop under the variant identity: the visible entry to the
       protein view. Every state keeps the same height (no layout shift). -->
  <div
    v-if="gene !== null"
    class="protein-strip"
    role="group"
    :aria-label="PROTEIN_VIEW_COPY.stripLabel"
    data-testid="protein-strip"
  >
    <div v-if="lookupsReason !== null" class="strip-line text-body-small text-muted">
      {{ lookupsReason }}
    </div>
    <template v-else>
      <!-- SV, intronic, splice, UTR: nothing to place on the protein; the gene structure shows it. -->
      <div v-if="protein === null" class="strip-line text-body-small text-muted">
        {{ PROTEIN_VIEW_COPY.noProteinPosition }}
      </div>
      <div v-else-if="error !== null" class="strip-line text-body-small text-muted">
        {{ PROTEIN_VIEW_COPY.loadFailed }}: {{ error }}
      </div>
      <v-skeleton-loader
        v-else-if="loading"
        type="image"
        height="28"
        class="strip-skeleton"
        data-testid="protein-strip-loading"
      />
      <template v-else>
        <!-- A light "paper" figure in both themes, like the full plot. -->
        <v-theme-provider theme="warmLight" with-background class="bg-surface strip-figure">
          <button
            type="button"
            class="strip-plot"
            data-testid="protein-strip-plot"
            :aria-label="`${summary}. Open the lollipop plot`"
            :data-tooltip="summary"
            data-tooltip-location="top"
            @click="emit('open', 'lollipop')"
          >
            <svg width="100%" height="24" aria-hidden="true">
              <rect x="0" y="10" width="100%" height="4" rx="2" class="strip-backbone" />
              <rect
                v-for="d in domains"
                :key="`${d.accession}-${d.start}`"
                data-testid="protein-strip-domain"
                :x="pct(d.start)"
                y="6"
                :width="pct(Math.max(1, d.end - d.start))"
                height="12"
                rx="2"
                :fill="getDomainColor(d.type)"
                opacity="0.85"
              />
              <line
                :x1="pct(protein.position)"
                :x2="pct(protein.position)"
                y1="6"
                y2="18"
                :stroke="markerColor"
                stroke-width="2"
              />
              <circle
                :cx="pct(protein.position)"
                cy="5"
                r="4"
                :fill="markerColor"
                class="strip-head"
              />
            </svg>
          </button>
        </v-theme-provider>
        <span class="text-body-small variant-data-mono text-no-wrap ml-2">
          p.{{ protein.position }} / {{ length }} aa
        </span>
      </template>
      <v-btn
        size="x-small"
        variant="text"
        color="primary"
        class="text-none text-body-small ml-1"
        data-testid="protein-strip-gene"
        @click="emit('open', 'gene-structure')"
      >
        {{ PROTEIN_VIEW_COPY.geneStructure }}
      </v-btn>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useQuery, useQueryCache } from '@pinia/colada'
import { queryKeys } from '../../queries/keys'
import type { Variant } from '../../../../shared/types/api'
import type { CohortVariant } from '../../../../shared/types/cohort'
import { getConsequenceColor, getDomainColor } from '../../../../shared/utils/protein-utils'
import {
  PROTEIN_STRIP_DWELL_MS,
  PROTEIN_VIEW_COPY,
  type ProteinViewTab
} from '../../config/proteinViewConfig'
import { proteinMappingQuery, proteinDomainsQuery } from '../../queries/protein'
import { useProteinLookupsReason } from '../../composables/useProteinLookupsReason'
import { formatError } from '../../utils/ipc-result'
import { proteinPositionOf, proteinStripSummary } from '../../utils/protein-view'

const props = defineProps<{ variant: Variant | CohortVariant }>()
const emit = defineEmits<{ open: [tab: ProteinViewTab] }>()

const lookupsReason = useProteinLookupsReason()
const gene = computed(() =>
  props.variant.gene_symbol === '' ? null : (props.variant.gene_symbol ?? null)
)
// No gene: no strip. No protein position: a gene-level line, no lookup.
const protein = computed(() => (gene.value === null ? null : proteinPositionOf(props.variant)))

// The full view's cached queries (useProteinData). A gene not looked up yet
// waits for a dwell on it, so stepping through rows sends no burst of lookups.
const queryCache = useQueryCache()
const lookupGene = ref<string | null>(null)
let dwellTimer: ReturnType<typeof setTimeout> | undefined
watch(
  () => (protein.value === null || lookupsReason.value !== null ? null : gene.value),
  (next) => {
    clearTimeout(dwellTimer)
    const cached =
      next === null ? undefined : queryCache.getQueryData(queryKeys.protein('mapping', next))
    lookupGene.value = cached === undefined ? null : next
    if (next !== null && lookupGene.value === null) {
      dwellTimer = setTimeout(() => (lookupGene.value = next), PROTEIN_STRIP_DWELL_MS)
    }
  },
  { immediate: true }
)
onBeforeUnmount(() => clearTimeout(dwellTimer))
const mappingQuery = useQuery(() => proteinMappingQuery(lookupGene.value))
const accession = computed(() => mappingQuery.data.value?.uniprotAccession ?? null)
const domainsQuery = useQuery(() => proteinDomainsQuery(accession.value))

const error = computed(() => {
  const err = mappingQuery.error.value ?? domainsQuery.error.value
  return err === null ? null : formatError(err, 'Unknown error')
})
// Until both have answered (a disabled domains query stays pending too).
const loading = computed(() =>
  [mappingQuery, domainsQuery].some((q) => q.status.value === 'pending')
)
const domains = computed(() => domainsQuery.data.value?.domains ?? [])
// InterPro answers 0 for a protein without domains: then the mapping knows.
const length = computed(() => {
  const fromDomains = domainsQuery.data.value?.proteinLength ?? 0
  return fromDomains > 0 ? fromDomains : (mappingQuery.data.value?.proteinLength ?? 0)
})
const pct = (aa: number): string => `${Math.min(100, (aa / Math.max(1, length.value)) * 100)}%`
const markerColor = computed(() => getConsequenceColor(props.variant.consequence ?? 'unknown'))
const summary = computed(() =>
  protein.value === null
    ? ''
    : proteinStripSummary(protein.value.position, length.value, domains.value)
)
</script>

<style scoped>
.protein-strip {
  display: flex;
  align-items: center;
  height: 40px;
}

.strip-line {
  flex: 1 1 auto;
  line-height: 1.3;
}

.strip-skeleton,
.strip-figure {
  flex: 1 1 auto;
  min-width: 0;
  height: 28px;
  border-radius: 4px;
}

.strip-figure {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
}

.strip-plot {
  display: block;
  width: 100%;
  height: 100%;
  padding: 2px 8px;
  border: 0;
  cursor: pointer;
  border-radius: 4px;
}

.strip-plot:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
}

.strip-plot:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 1px;
}

.strip-plot svg {
  display: block;
  overflow: visible;
}

.strip-backbone {
  fill: rgba(var(--v-theme-on-surface), 0.16);
}

.strip-head {
  stroke: rgb(var(--v-theme-on-surface));
  stroke-width: 1;
}
</style>
