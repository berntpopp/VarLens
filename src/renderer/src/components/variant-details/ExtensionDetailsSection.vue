<script setup lang="ts">
import { computed } from 'vue'
import { buildStatus, formatBpLength, normalizeBuild } from '../../utils/variant-interval'
import { EMPTY_VALUE_PLACEHOLDER } from '../../config/displayConfig'
import { COHORT_CALL_EVIDENCE_NOTE } from '../../config/uiCopyConfig'

/**
 * Conditional detail section showing SV/CNV/STR-specific data based on variant_type.
 *
 * The variant object may have additional `_sv_*`, `_cnv_*`, `_str_*` fields
 * flattened from the extension table JOIN in the backend query.
 */

interface ExtensionVariant {
  chr?: string
  pos?: number
  alt?: string
  variant_type?: string | null
  sv_type?: string | null
  sv_length?: number | null
  end_pos?: number | null
  caller?: string | null

  // SV extension fields
  _sv_support?: number | null
  _sv_dr?: number | null
  _sv_dv?: number | null
  _sv_vaf?: number | null
  _sv_is_precise?: number | null
  _sv_strand?: string | null
  _sv_coverage?: string | null
  _sv_stdev_len?: number | null
  _sv_stdev_pos?: number | null

  // CNV extension fields
  _cnv_copy_number?: number | null
  _cnv_gq?: number | null
  _cnv_ho_ref?: number | null
  _cnv_ho_alt?: number | null

  // STR extension fields
  _str_repeat_id?: string | null
  _str_repeat_unit?: string | null
  _str_display_ru?: string | null
  _str_ref_copies?: number | null
  _str_alt_copies?: string | null
  _str_status?: string | null
  _str_normal_max?: number | null
  _str_pathologic_min?: number | null
  _str_disease?: string | null
  _str_inheritance_mode?: string | null
  _str_rank_score?: string | null
}

interface Props {
  /**
   * Accepts any variant-shaped object; the component reads optional extension
   * fields that may or may not be present depending on variant_type.
   */
  variant: Record<string, unknown> | null
  /** Genome build of the variant's case; null when unknown */
  genomeBuild?: string | null
  /** A cohort row: call context only, per-call evidence lives with each carrier */
  summaryOnly?: boolean
}

const props = defineProps<Props>()

// Cast the opaque variant prop to the ExtensionVariant shape for template access.
// Missing fields are undefined, which the template already handles.
const variant = computed<ExtensionVariant | null>(
  () => (props.variant as unknown as ExtensionVariant | null) ?? null
)

const variantType = computed(() => variant.value?.variant_type ?? null)

const isSv = computed(() => variantType.value === 'sv')
const isCnv = computed(() => variantType.value === 'cnv')
const isStr = computed(() => variantType.value === 'str')
const showSection = computed(() =>
  props.summaryOnly ? isSv.value || isCnv.value : isSv.value || isCnv.value || isStr.value
)
const showEvidence = computed(() => !props.summaryOnly)

const strStatusColor = computed(() => {
  const status = variant.value?._str_status ?? ''
  if (status.includes('full_mutation')) return 'error'
  if (status.includes('pre_mutation')) return 'warning'
  if (status.includes('normal')) return 'success'
  return 'default'
})

const isCall = computed(() => isSv.value || isCnv.value)
const isBreakend = computed(() => variant.value?.sv_type?.toUpperCase() === 'BND')
const buildLabel = computed(() => normalizeBuild(props.genomeBuild) ?? 'Unknown build')
const buildChipColor = computed(() =>
  buildStatus(props.genomeBuild) === 'unknown' ? 'warning' : 'default'
)

/** chr:start-end for an interval call; a breakend is a single position with its mate in ALT. */
const coordinates = computed(() => {
  const v = variant.value
  if (v?.chr === undefined || v.pos === undefined) return EMPTY_VALUE_PLACEHOLDER
  const start = `${v.chr}:${v.pos.toLocaleString()}`
  if (isBreakend.value) return `${start} (breakend, mate ${v.alt ?? 'not reported'})`
  if (v.end_pos === null || v.end_pos === undefined) return `${start} (end not reported)`
  return `${start}-${v.end_pos.toLocaleString()}`
})

const callerLabel = computed(() => {
  const caller = variant.value?.caller ?? ''
  return caller === '' ? 'Not reported' : caller
})

const hasSvEvidence = computed(() => {
  const v = variant.value
  return [v?._sv_support, v?._sv_dr, v?._sv_dv, v?._sv_vaf].some(
    (x) => x !== null && x !== undefined
  )
})
const hasCnvEvidence = computed(() => {
  const v = variant.value
  return [v?._cnv_copy_number, v?._cnv_gq, v?._cnv_ho_ref].some(
    (x) => x !== null && x !== undefined
  )
})

const sectionTitle = computed(() => {
  if (isSv.value) return 'Structural Variant'
  if (isCnv.value) return 'Copy Number Variant'
  if (isStr.value) return 'Short Tandem Repeat'
  return ''
})

function formatNumber(val: number | null | undefined, digits = 2): string {
  if (val === null || val === undefined) return EMPTY_VALUE_PLACEHOLDER
  return val.toFixed(digits)
}

function formatText(val: string | null | undefined): string {
  if (val === null || val === undefined || val === '') return EMPTY_VALUE_PLACEHOLDER
  return val.replace(/_/g, ' ') // caller tokens such as full_mutation
}
</script>

<template>
  <div v-if="showSection" class="extension-section mb-4">
    <div class="d-flex align-center mb-2">
      <h3 class="text-title-small">{{ sectionTitle }}</h3>
      <v-chip v-if="isStr && variant?.caller" size="x-small" class="ml-2" variant="tonal">
        {{ variant.caller }}
      </v-chip>
    </div>

    <!-- Call context (#539): build, coordinates, type, length and caller together -->
    <v-list
      v-if="isCall"
      density="compact"
      bg-color="transparent"
      class="pa-0"
      data-testid="call-context"
    >
      <v-list-item class="px-2">
        <template #prepend>
          <span class="text-medium-emphasis text-caption mr-2" style="min-width: 110px">Build</span>
        </template>
        <v-chip size="x-small" :color="buildChipColor" variant="tonal" data-testid="call-build">
          {{ buildLabel }}
        </v-chip>
      </v-list-item>
      <v-list-item class="px-2">
        <template #prepend>
          <span class="text-medium-emphasis text-caption mr-2" style="min-width: 110px"
            >Coordinates</span
          >
        </template>
        <span data-testid="call-coordinates">{{ coordinates }}</span>
      </v-list-item>
      <v-list-item class="px-2">
        <template #prepend>
          <span class="text-medium-emphasis text-caption mr-2" style="min-width: 110px">Type</span>
        </template>
        <v-chip
          v-if="variant?.sv_type"
          size="small"
          :color="
            variant.sv_type === 'DEL' ? 'error' : variant.sv_type === 'DUP' ? 'info' : 'primary'
          "
          variant="tonal"
        >
          {{ variant.sv_type }}
        </v-chip>
        <span v-else class="text-medium-emphasis">Not reported</span>
      </v-list-item>
      <v-list-item class="px-2">
        <template #prepend>
          <span class="text-medium-emphasis text-caption mr-2" style="min-width: 110px"
            >Length</span
          >
        </template>
        <span data-testid="call-length">{{
          isBreakend ? 'Not applicable (breakend)' : formatBpLength(variant?.sv_length)
        }}</span>
      </v-list-item>
      <v-list-item v-if="showEvidence" class="px-2">
        <template #prepend>
          <span class="text-medium-emphasis text-caption mr-2" style="min-width: 110px"
            >Caller</span
          >
        </template>
        <span data-testid="call-caller">{{ callerLabel }}</span>
      </v-list-item>
      <v-list-item v-else class="px-2">
        <span class="text-medium-emphasis text-caption" data-testid="carrier-evidence-note">{{
          COHORT_CALL_EVIDENCE_NOTE
        }}</span>
      </v-list-item>
    </v-list>

    <!-- SV Section -->
    <v-list v-if="isSv && showEvidence" density="compact" bg-color="transparent" class="pa-0">
      <v-list-item v-if="!hasSvEvidence" class="px-2" data-testid="missing-evidence">
        <span class="text-medium-emphasis">No read-support evidence reported for this call</span>
      </v-list-item>
      <v-list-item class="px-2">
        <template #prepend>
          <span class="text-medium-emphasis text-caption mr-2" style="min-width: 110px"
            >Precision</span
          >
        </template>
        <v-chip v-if="variant?._sv_is_precise === 1" size="x-small" color="success" variant="tonal">
          Precise
        </v-chip>
        <v-chip v-else size="x-small" color="warning" variant="tonal">Imprecise</v-chip>
      </v-list-item>
      <v-list-item
        v-if="variant?._sv_support !== null && variant?._sv_support !== undefined"
        class="px-2"
      >
        <template #prepend>
          <span class="text-medium-emphasis text-caption mr-2" style="min-width: 110px"
            >Support Reads</span
          >
        </template>
        {{ variant._sv_support }}
      </v-list-item>
      <v-list-item v-if="variant?._sv_dr !== null && variant?._sv_dr !== undefined" class="px-2">
        <template #prepend>
          <span class="text-medium-emphasis text-caption mr-2" style="min-width: 110px"
            >Ref / Var Reads</span
          >
        </template>
        {{ variant._sv_dr }} / {{ variant._sv_dv ?? EMPTY_VALUE_PLACEHOLDER }}
      </v-list-item>
      <v-list-item v-if="variant?._sv_vaf !== null && variant?._sv_vaf !== undefined" class="px-2">
        <template #prepend>
          <span class="text-medium-emphasis text-caption mr-2" style="min-width: 110px">VAF</span>
        </template>
        {{ formatNumber(variant._sv_vaf, 3) }}
      </v-list-item>
      <v-list-item v-if="variant?._sv_strand" class="px-2">
        <template #prepend>
          <span class="text-medium-emphasis text-caption mr-2" style="min-width: 110px"
            >Strand</span
          >
        </template>
        {{ variant._sv_strand }}
      </v-list-item>
      <v-list-item
        v-if="variant?._sv_stdev_len !== null && variant?._sv_stdev_len !== undefined"
        class="px-2"
      >
        <template #prepend>
          <span class="text-medium-emphasis text-caption mr-2" style="min-width: 110px"
            >Length StdDev</span
          >
        </template>
        {{ formatNumber(variant._sv_stdev_len) }}
      </v-list-item>
    </v-list>

    <!-- CNV Section -->
    <v-list v-if="isCnv && showEvidence" density="compact" bg-color="transparent" class="pa-0">
      <v-list-item v-if="!hasCnvEvidence" class="px-2" data-testid="missing-evidence">
        <span class="text-medium-emphasis">No copy-number evidence reported for this call</span>
      </v-list-item>
      <v-list-item
        v-if="variant?._cnv_copy_number !== null && variant?._cnv_copy_number !== undefined"
        class="px-2"
      >
        <template #prepend>
          <span class="text-medium-emphasis text-caption mr-2" style="min-width: 110px"
            >Copy Number</span
          >
        </template>
        <v-chip size="small" variant="tonal" color="primary">{{ variant._cnv_copy_number }}</v-chip>
      </v-list-item>
      <v-list-item
        v-if="variant?._cnv_ho_ref !== null && variant?._cnv_ho_ref !== undefined"
        class="px-2"
      >
        <template #prepend>
          <span class="text-medium-emphasis text-caption mr-2" style="min-width: 110px"
            >Homozygosity</span
          >
        </template>
        Ref: {{ formatNumber(variant._cnv_ho_ref, 2) }} / Alt:
        {{ formatNumber(variant._cnv_ho_alt, 2) }}
      </v-list-item>
      <v-list-item v-if="variant?._cnv_gq !== null && variant?._cnv_gq !== undefined" class="px-2">
        <template #prepend>
          <span class="text-medium-emphasis text-caption mr-2" style="min-width: 110px"
            >CN Quality</span
          >
        </template>
        {{ variant._cnv_gq }}
      </v-list-item>
    </v-list>

    <!-- STR Section -->
    <v-list v-if="isStr && showEvidence" density="compact" bg-color="transparent" class="pa-0">
      <v-list-item v-if="variant?._str_repeat_id" class="px-2">
        <template #prepend>
          <span class="text-medium-emphasis text-caption mr-2" style="min-width: 110px">Locus</span>
        </template>
        <v-chip size="small" variant="tonal" color="primary">
          {{ variant._str_repeat_id }}
        </v-chip>
      </v-list-item>
      <v-list-item v-if="variant?._str_disease" class="px-2">
        <template #prepend>
          <span class="text-medium-emphasis text-caption mr-2" style="min-width: 110px"
            >Disease</span
          >
        </template>
        <strong>{{ formatText(variant._str_disease) }}</strong>
      </v-list-item>
      <v-list-item v-if="variant?._str_status" class="px-2">
        <template #prepend>
          <span class="text-medium-emphasis text-caption mr-2" style="min-width: 110px"
            >Status</span
          >
        </template>
        <v-chip size="small" :color="strStatusColor" variant="tonal">
          {{ formatText(variant._str_status) }}
        </v-chip>
      </v-list-item>
      <v-list-item v-if="variant?._str_repeat_unit" class="px-2">
        <template #prepend>
          <span class="text-medium-emphasis text-caption mr-2" style="min-width: 110px"
            >Repeat Unit</span
          >
        </template>
        <code>{{ variant._str_repeat_unit }}</code>
        <span v-if="variant._str_display_ru" class="text-medium-emphasis ml-2">
          (display: <code>{{ variant._str_display_ru }}</code
          >)
        </span>
      </v-list-item>
      <v-list-item class="px-2">
        <template #prepend>
          <span class="text-medium-emphasis text-caption mr-2" style="min-width: 110px"
            >Copies</span
          >
        </template>
        Ref: {{ formatText(variant?._str_ref_copies?.toString()) }} / Alt:
        <strong>{{ formatText(variant?._str_alt_copies) }}</strong>
      </v-list-item>
      <v-list-item class="px-2">
        <template #prepend>
          <span class="text-medium-emphasis text-caption mr-2" style="min-width: 110px"
            >Thresholds</span
          >
        </template>
        Normal ≤ {{ variant?._str_normal_max ?? EMPTY_VALUE_PLACEHOLDER }} | Pathologic ≥
        {{ variant?._str_pathologic_min ?? EMPTY_VALUE_PLACEHOLDER }}
      </v-list-item>
      <v-list-item v-if="variant?._str_inheritance_mode" class="px-2">
        <template #prepend>
          <span class="text-medium-emphasis text-caption mr-2" style="min-width: 110px"
            >Inheritance</span
          >
        </template>
        {{ formatText(variant._str_inheritance_mode) }}
      </v-list-item>
      <v-list-item v-if="variant?._str_rank_score" class="px-2">
        <template #prepend>
          <span class="text-medium-emphasis text-caption mr-2" style="min-width: 110px"
            >Rank Score</span
          >
        </template>
        {{ variant._str_rank_score }}
      </v-list-item>
    </v-list>

    <v-divider class="mt-3" />
  </div>
</template>

<style scoped>
.extension-section :deep(.v-list-item) {
  min-height: 32px;
}

code {
  background: rgba(0, 0, 0, 0.05);
  padding: 1px 4px;
  border-radius: 3px;
  font-family: var(--font-mono);
  font-size: 0.85em;
}
</style>
