<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue'
import type { VepTranscriptConsequence } from '../../../main/services/api/schemas/vep-response'
import type { TranscriptInsertRow } from '../../../shared/types/transcript'
import { useTranscripts } from '../composables/useTranscripts'
import {
  mergeTranscripts,
  normalizeTranscriptId,
  type UnifiedTranscriptRow
} from '../utils/mergeTranscripts'
import { EMPTY_VALUE_PLACEHOLDER } from '../utils/formatters'

const props = defineProps<{
  variantId: number | null
  vepTranscripts: VepTranscriptConsequence[]
  vepLoading: boolean
  mode: 'case' | 'cohort'
  variantChr?: string
  variantPos?: number
  variantRef?: string
  variantAlt?: string
  fetchVep?: (chr: string, pos: number, ref: string, alt: string) => Promise<void>
}>()

const emit = defineEmits<{
  'transcript-switched': []
}>()

// Only use DB transcripts in case mode with a valid variantId
const variantIdRef = toRef(props, 'variantId')
const {
  transcripts: dbTranscripts,
  loading: dbLoading,
  switchTranscript,
  insertAndSwitch
} = useTranscripts(variantIdRef)

// Merged transcript list
const mergedRows = computed(() =>
  mergeTranscripts(props.mode === 'case' ? dbTranscripts.value : [], props.vepTranscripts)
)

const isLoading = computed(() => {
  if (props.mode === 'case') return dbLoading.value || props.vepLoading
  return props.vepLoading
})

const hasTranscripts = computed(() => mergedRows.value.length > 0)

const tableExpanded = ref(false)
const vepFetched = ref(false)
const canFetchVep = computed(
  () =>
    props.fetchVep !== undefined &&
    props.variantChr !== undefined &&
    props.variantPos !== undefined &&
    props.variantRef !== undefined &&
    props.variantAlt !== undefined &&
    !props.vepLoading &&
    !vepFetched.value
)

// Reset VEP state when variant changes
watch(
  () => [props.variantChr, props.variantPos, props.variantRef, props.variantAlt],
  () => {
    vepFetched.value = false
  }
)

async function handleFetchVep(): Promise<void> {
  if (!canFetchVep.value || props.fetchVep === undefined) return
  vepFetched.value = true
  await props.fetchVep(props.variantChr!, props.variantPos!, props.variantRef!, props.variantAlt!)
}

const headers = computed(() => {
  const cols = [
    { title: 'Source', key: 'source', sortable: false, width: '90px' },
    { title: 'Transcript', key: 'transcript_id', sortable: false },
    { title: 'Gene', key: 'gene_symbol', sortable: false },
    { title: 'Consequence', key: 'consequence', sortable: false },
    { title: 'cDNA', key: 'cdna', sortable: false },
    { title: 'Protein', key: 'aa_change', sortable: false },
    { title: 'Status', key: 'status', sortable: false, width: '220px' }
  ]
  return cols
})

function impactColor(impact: string | null): string {
  if (impact === null) return 'grey'
  if (impact === 'HIGH') return 'error'
  if (impact === 'MODERATE') return 'warning'
  if (impact === 'LOW') return 'info'
  return 'grey'
}

function sourceIcon(source: string): string {
  if (source === 'imported') return 'mdi-database'
  if (source === 'vep') return 'mdi-cloud'
  return 'mdi-check-all'
}

function sourceColor(source: string): string {
  if (source === 'imported') return 'blue-grey'
  if (source === 'vep') return 'deep-purple'
  return 'teal'
}

function sourceLabel(source: string): string {
  if (source === 'imported') return 'Import'
  if (source === 'vep') return 'VEP'
  return 'Both'
}

function vepSourceColor(vepSource: string | null): string {
  if (vepSource === 'RefSeq') return 'orange'
  if (vepSource === 'Ensembl') return 'indigo'
  return 'grey'
}

function consequenceTooltip(row: UnifiedTranscriptRow): string | null {
  if (row.consequence_terms !== null && row.consequence_terms.length > 0) {
    return row.consequence_terms.join(', ')
  }
  return null
}

/**
 * Map a VEP transcript to TranscriptInsertRow for DB insertion.
 */
function vepToInsertRow(vep: VepTranscriptConsequence): TranscriptInsertRow {
  return {
    transcript_id: normalizeTranscriptId(vep.transcript_id),
    gene_symbol: vep.gene_symbol ?? null,
    consequence: vep.impact ?? null,
    cdna: null,
    aa_change: null,
    hpo_sim_score: null,
    moi: null,
    is_selected: 0
  }
}

async function handleUse(row: UnifiedTranscriptRow): Promise<void> {
  let success = false

  if (row._dbRow !== null) {
    // DB transcript — use existing switch
    success = await switchTranscript(row._dbRow.transcript_id)
  } else if (row._vepRow !== null) {
    // VEP-only transcript — insert then switch
    success = await insertAndSwitch(vepToInsertRow(row._vepRow))
  }

  if (success) {
    emit('transcript-switched')
  }
}
</script>

<template>
  <v-card variant="outlined" class="mb-4">
    <v-card-title class="d-flex align-center text-body-large py-2 px-4">
      Transcripts
      <v-chip v-if="hasTranscripts" size="x-small" class="ml-2" color="secondary">
        {{ mergedRows.length }}
      </v-chip>
      <v-spacer />
      <v-btn
        v-if="canFetchVep"
        size="x-small"
        variant="tonal"
        color="deep-purple"
        prepend-icon="mdi-cloud-download"
        @click="handleFetchVep"
      >
        Fetch VEP
      </v-btn>
      <v-chip
        v-if="vepFetched && !vepLoading && vepTranscripts.length > 0"
        size="x-small"
        color="deep-purple"
        variant="outlined"
      >
        VEP loaded
      </v-chip>
      <v-btn
        v-if="hasTranscripts"
        size="x-small"
        variant="text"
        :icon="tableExpanded ? 'mdi-chevron-up' : 'mdi-chevron-down'"
        class="ml-1"
        @click="tableExpanded = !tableExpanded"
      />
    </v-card-title>

    <v-divider />

    <v-progress-linear v-if="isLoading" indeterminate color="primary" />

    <div v-if="!isLoading && !hasTranscripts" class="pa-4 text-body-medium text-medium-emphasis">
      No transcript annotations available for this variant.
    </div>

    <div
      v-if="hasTranscripts"
      class="transcript-scroll-wrapper"
      :style="{ maxHeight: tableExpanded ? 'none' : '280px', overflowY: 'auto' }"
    >
      <v-data-table
        :headers="headers"
        :items="mergedRows"
        density="compact"
        :items-per-page="-1"
        hide-default-footer
        class="transcript-table"
      >
        <template #[`item.transcript_id`]="{ item }">
          <span class="text-body-medium">{{ item.transcript_id }}</span>
          <v-chip
            v-if="item.vep_source"
            :color="vepSourceColor(item.vep_source)"
            size="x-small"
            label
            class="ml-1"
          >
            {{ item.vep_source }}
          </v-chip>
        </template>

        <template #[`item.source`]="{ item }">
          <v-chip
            :color="sourceColor(item.source)"
            size="x-small"
            label
            :prepend-icon="sourceIcon(item.source)"
          >
            {{ sourceLabel(item.source) }}
          </v-chip>
        </template>

        <template #[`item.consequence`]="{ item }">
          <v-tooltip v-if="item.impact || item.consequence" :text="consequenceTooltip(item) ?? ''">
            <template #activator="{ props: tooltipProps }">
              <v-chip
                v-bind="consequenceTooltip(item) !== null ? tooltipProps : undefined"
                :color="impactColor(item.impact ?? item.consequence)"
                size="x-small"
                label
              >
                {{ item.impact ?? item.consequence }}
              </v-chip>
            </template>
          </v-tooltip>
          <span v-else class="text-medium-emphasis">{{ EMPTY_VALUE_PLACEHOLDER }}</span>
        </template>

        <template #[`item.cdna`]="{ value }">
          <span class="text-body-medium">{{ value ?? EMPTY_VALUE_PLACEHOLDER }}</span>
        </template>

        <template #[`item.aa_change`]="{ value }">
          <span class="text-body-medium">{{ value ?? EMPTY_VALUE_PLACEHOLDER }}</span>
        </template>

        <template #[`item.status`]="{ item }">
          <div class="d-flex ga-1 align-center">
            <v-chip v-if="item.is_selected" size="x-small" color="primary" label> Selected </v-chip>
            <v-chip v-if="item.is_mane_select" size="x-small" color="teal" label> MANE </v-chip>
            <v-chip v-if="item.is_canonical" size="x-small" color="grey" label> Canonical </v-chip>
            <v-btn
              v-if="mode === 'case' && !item.is_selected"
              size="x-small"
              variant="text"
              color="primary"
              @click="handleUse(item)"
            >
              Use
            </v-btn>
          </div>
        </template>
      </v-data-table>
    </div>
  </v-card>
</template>

<style scoped>
.transcript-table :deep(th) {
  font-size: 0.75rem !important;
}
</style>
