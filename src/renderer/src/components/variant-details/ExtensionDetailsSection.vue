<script setup lang="ts">
import { computed } from 'vue'

/**
 * Conditional detail section showing SV/CNV/STR-specific data based on variant_type.
 *
 * The variant object may have additional `_sv_*`, `_cnv_*`, `_str_*` fields
 * flattened from the extension table JOIN in the backend query.
 */

interface ExtensionVariant {
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
const showSection = computed(() => isSv.value || isCnv.value || isStr.value)

const strStatusColor = computed(() => {
  const status = variant.value?._str_status ?? ''
  if (status.includes('full_mutation')) return 'error'
  if (status.includes('pre_mutation')) return 'warning'
  if (status.includes('normal')) return 'success'
  return 'default'
})

const sectionTitle = computed(() => {
  if (isSv.value) return 'Structural Variant'
  if (isCnv.value) return 'Copy Number Variant'
  if (isStr.value) return 'Short Tandem Repeat'
  return ''
})

function formatLength(length: number | null | undefined): string {
  if (length === null || length === undefined) return '—'
  const abs = Math.abs(length)
  if (abs >= 1_000_000) return `${(length / 1_000_000).toFixed(2)} Mb`
  if (abs >= 1_000) return `${(length / 1_000).toFixed(2)} kb`
  return `${length} bp`
}

function formatNumber(val: number | null | undefined, digits = 2): string {
  if (val === null || val === undefined) return '—'
  return val.toFixed(digits)
}

function formatInt(val: number | null | undefined): string {
  if (val === null || val === undefined) return '—'
  return val.toLocaleString()
}

function formatText(val: string | null | undefined): string {
  if (val === null || val === undefined || val === '') return '—'
  return val
}
</script>

<template>
  <div v-if="showSection" class="extension-section mb-4">
    <div class="d-flex align-center mb-2">
      <div class="text-title-small">{{ sectionTitle }}</div>
      <v-chip v-if="variant?.caller" size="x-small" class="ml-2" variant="tonal">
        {{ variant.caller }}
      </v-chip>
    </div>

    <!-- SV Section -->
    <v-list v-if="isSv" density="compact" bg-color="transparent" class="pa-0">
      <v-list-item v-if="variant?.sv_type" class="px-2">
        <template #prepend>
          <span class="text-medium-emphasis text-caption mr-2" style="min-width: 110px"
            >SV Type</span
          >
        </template>
        <v-chip size="small" color="primary" variant="tonal">{{ variant.sv_type }}</v-chip>
      </v-list-item>
      <v-list-item class="px-2">
        <template #prepend>
          <span class="text-medium-emphasis text-caption mr-2" style="min-width: 110px"
            >Length</span
          >
        </template>
        {{ formatLength(variant?.sv_length) }}
      </v-list-item>
      <v-list-item v-if="variant?.end_pos" class="px-2">
        <template #prepend>
          <span class="text-medium-emphasis text-caption mr-2" style="min-width: 110px"
            >End Position</span
          >
        </template>
        {{ formatInt(variant.end_pos) }}
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
        {{ variant._sv_dr }} / {{ variant._sv_dv ?? '—' }}
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
    <v-list v-if="isCnv" density="compact" bg-color="transparent" class="pa-0">
      <v-list-item v-if="variant?.sv_type" class="px-2">
        <template #prepend>
          <span class="text-medium-emphasis text-caption mr-2" style="min-width: 110px">Type</span>
        </template>
        <v-chip size="small" :color="variant.sv_type === 'DEL' ? 'error' : 'info'" variant="tonal">
          {{ variant.sv_type }}
        </v-chip>
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
      <v-list-item class="px-2">
        <template #prepend>
          <span class="text-medium-emphasis text-caption mr-2" style="min-width: 110px"
            >Length</span
          >
        </template>
        {{ formatLength(variant?.sv_length) }}
      </v-list-item>
      <v-list-item v-if="variant?.end_pos" class="px-2">
        <template #prepend>
          <span class="text-medium-emphasis text-caption mr-2" style="min-width: 110px"
            >End Position</span
          >
        </template>
        {{ formatInt(variant.end_pos) }}
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
    <v-list v-if="isStr" density="compact" bg-color="transparent" class="pa-0">
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
        Normal ≤ {{ variant?._str_normal_max ?? '—' }} | Pathologic ≥
        {{ variant?._str_pathologic_min ?? '—' }}
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
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 0.85em;
}
</style>
