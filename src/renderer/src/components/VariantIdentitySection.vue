<template>
  <div class="variant-identity-section">
    <div class="d-flex align-center flex-wrap ga-1 mb-2">
      <h3 class="text-title-large mr-1">{{ title }}</h3>
      <!-- Unavailable buttons stay focusable (aria-disabled) so keyboard and
           screen-reader users get the reason too, not only a hover tooltip. -->
      <template v-for="button in PROTEIN_VIEW_BUTTONS" :key="button.tab">
        <v-btn
          size="x-small"
          variant="tonal"
          color="primary"
          class="text-none"
          :class="{ 'protein-btn--unavailable': reasonFor(button.tab) !== null }"
          :prepend-icon="button.icon"
          :aria-disabled="reasonFor(button.tab) !== null ? 'true' : undefined"
          :aria-describedby="reasonFor(button.tab) !== null ? `${uid}-${button.tab}` : undefined"
          :data-tooltip="reasonFor(button.tab) ?? undefined"
          data-tooltip-location="top"
          @click="openTab(button.tab)"
        >
          {{ button.label }}
        </v-btn>
        <span
          v-if="reasonFor(button.tab) !== null"
          :id="`${uid}-${button.tab}`"
          class="visually-hidden"
        >
          {{ reasonFor(button.tab) }}
        </span>
      </template>
    </div>

    <!-- Transcript + cDNA + protein change -->
    <div v-if="hgvsText" class="d-flex align-center mb-1">
      <span class="hgvs-notation">{{ hgvsText }}</span>
      <IconButton
        v-if="variant.cdna"
        :label="hgvsCopied ? 'HGVS copied' : 'Copy HGVS notation'"
        :icon="hgvsCopied ? mdiCheck : mdiContentCopy"
        size="x-small"
        tooltip-location="top"
        class="ml-2"
        @click="copyHgvsText(withGenomeBuild(hgvsText, genomeBuild))"
      />
    </div>

    <!-- Genomic position + alleles -->
    <div class="d-flex align-center">
      <span v-if="genomeBuild" data-testid="genome-build" class="text-body-small text-muted mr-1">
        {{ genomeBuild }}
      </span>
      <span class="genomic-coordinate">{{ variant.chr }}:{{ formatPosition(variant.pos) }}</span>
      <span class="variant-data-mono ml-1">{{ variant.ref }} &gt; {{ variant.alt }}</span>
      <IconButton
        :label="variantCopied ? 'Variant copied' : 'Copy build chr:pos:ref:alt'"
        :icon="variantCopied ? mdiCheck : mdiContentCopy"
        size="x-small"
        tooltip-location="top"
        class="ml-2"
        @click="copyVariant"
      />
    </div>

    <!-- ClinVar + per-sample call quality (case rows only carry a call) -->
    <div v-if="variant.clinvar || callLine" class="d-flex align-center flex-wrap ga-2 mt-1">
      <span v-if="variant.clinvar" data-testid="clinvar-line" class="d-flex align-center ga-1">
        <span class="text-body-small text-muted">{{ IDENTITY_COPY.clinvar }}</span>
        <ClinVarCell :significance="variant.clinvar" />
      </span>
      <span v-if="callLine" data-testid="call-line" class="variant-data-mono">{{ callLine }}</span>
    </div>

    <!-- rsID - From VEP colocated_variants -->
    <div class="d-flex align-center mt-2">
      <span class="text-body-small text-muted">{{ IDENTITY_COPY.rsid }}</span>
      <template v-if="rsId">
        <span class="ml-1 variant-data-mono">{{ rsId }}</span>
        <IconButton
          :label="rsIdCopied ? 'rsID copied' : 'Copy rsID'"
          :icon="rsIdCopied ? mdiCheck : mdiContentCopy"
          size="x-small"
          tooltip-location="top"
          class="ml-2"
          @click="copyRsId"
        />
      </template>
      <span v-else class="ml-1 text-muted">N/A</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, useId } from 'vue'
import { useClipboard } from '../composables/useClipboard'
import type { Variant } from '../../../shared/types/api'
import type { CohortVariant } from '../../../shared/types/cohort'
import type { VepColocatedVariant } from '../../../shared/types/vep'
import { mdiCheck, mdiContentCopy } from '@mdi/js'
import { PROTEIN_VIEW_BUTTONS, type ProteinViewTab } from '../config/proteinViewConfig'
import { proteinTabReason, proteinViewBlockedReason } from '../utils/protein-view'
import { useProteinLookupsReason } from '../composables/useProteinLookupsReason'
import IconButton from './common/IconButton.vue'
import { formatHgvs, variantName } from '../utils/formatters'
import { ClinVarCell } from './table-cells/simple-cells'
import { CALL_QUALITY_FIELDS, IDENTITY_COPY } from '../config/uiCopyConfig'
import { INLINE_SEPARATOR } from '../config/displayConfig'
import { withGenomeBuild } from '../../../shared/config/genome-builds.config'

interface Props {
  variant: Variant | CohortVariant
  colocatedVariants?: VepColocatedVariant[]
  /** Build of the coordinates and HGVS, shown and copied with them; null while unknown. */
  genomeBuild?: string | null
}

const props = withDefaults(defineProps<Props>(), {
  colocatedVariants: () => [],
  genomeBuild: null
})

const emit = defineEmits<{
  'open-protein-view': [tab: ProteinViewTab]
}>()

const lookupsReason = useProteinLookupsReason()
const proteinReason = computed(() => proteinViewBlockedReason(props.variant, lookupsReason.value))
const reasonFor = (tab: ProteinViewTab): string | null =>
  proteinReason.value ?? proteinTabReason(props.variant, tab)
const uid = useId()
function openTab(tab: ProteinViewTab): void {
  if (reasonFor(tab) === null) emit('open-protein-view', tab)
}

/**
 * Check if variant is a full Variant (not CohortVariant)
 */
const isFullVariant = computed(() => {
  return 'transcript' in props.variant
})

/** "GT 0/1 · DP 34 · …" from the non-empty call fields; null for cohort rows. */
const callLine = computed(() => {
  if (!('gt_num' in props.variant)) return null
  const row = props.variant as unknown as Record<string, unknown>
  const parts = CALL_QUALITY_FIELDS.flatMap(({ key, label, digits }) => {
    const value = row[key]
    if (value === null || value === undefined || value === '') return []
    const text = typeof value === 'number' && digits !== undefined ? value.toFixed(digits) : value
    return [`${label}\u00a0${String(text)}`] // a field never wraps between label and value
  })
  return parts.length > 0 ? parts.join(INLINE_SEPARATOR) : null
})

// Create separate clipboard instances for each copy operation
const { copy: copyHgvsText, copied: hgvsCopied } = useClipboard()
const { copy: copyVariantText, copied: variantCopied } = useClipboard()
const { copy: copyRsIdText, copied: rsIdCopied } = useClipboard()

// An STR call has no gene symbol but a repeat id (e.g. FMR1_CGG) that names it
const title = computed(() => variantName(props.variant))

// Same string for display and Copy HGVS (VEP values already carry the versioned transcript)
const hgvsText = computed(() => {
  const transcript = isFullVariant.value ? (props.variant as Variant).transcript : null
  const parts = [formatHgvs(props.variant.cdna, transcript), formatHgvs(props.variant.aa_change)]
  return parts.filter((p) => p !== null).join(' ')
})

// Compute rsID from colocatedVariants
const rsId = computed(() => {
  if (props.colocatedVariants.length === 0) return null
  // Find first colocated variant with id starting with "rs"
  const rsVariant = props.colocatedVariants.find((v) => v.id !== undefined && v.id.startsWith('rs'))
  return rsVariant?.id ?? null
})

/**
 * Format position with thousand separators
 */
function formatPosition(pos: number): string {
  return pos.toLocaleString()
}

/**
 * Copy full variant notation (chr:pos:ref:alt) to clipboard
 */
async function copyVariant(): Promise<void> {
  const { chr, pos, ref, alt } = props.variant
  await copyVariantText(withGenomeBuild(`${chr}:${pos}:${ref}:${alt}`, props.genomeBuild))
}

/**
 * Copy rsID to clipboard
 */
async function copyRsId(): Promise<void> {
  if (rsId.value !== null) {
    await copyRsIdText(rsId.value)
  }
}
</script>

<style scoped>
.protein-btn--unavailable {
  opacity: 0.5;
  cursor: default;
}

.hgvs-notation {
  font-family: var(--font-mono);
  font-size: 0.875rem;
}

.genomic-coordinate {
  font-family: var(--font-mono);
  font-size: 0.875rem;
  color: rgb(var(--v-theme-primary));
}

.variant-data-mono {
  font-family: var(--font-mono);
  font-size: 0.875rem;
}
</style>
