<template>
  <div class="variant-identity-section">
    <div class="d-flex align-center mb-2">
      <div class="text-title-large">{{ variant.gene_symbol ?? 'Unknown Gene' }}</div>
      <v-tooltip v-if="variant.gene_symbol" location="top">
        <template #activator="{ props: tooltipProps }">
          <v-btn
            v-bind="tooltipProps"
            icon
            size="x-small"
            variant="text"
            class="ml-1"
            aria-label="Open protein view"
            @click="emit('open-protein-view')"
          >
            <v-icon size="small" :icon="mdiDna" />
          </v-btn>
        </template>
        Protein View
      </v-tooltip>
    </div>

    <!-- Transcript + cDNA + protein change -->
    <div
      v-if="variant.cdna || variant.aa_change || (isFullVariant && (variant as Variant).transcript)"
      class="d-flex align-center mb-1"
    >
      <span class="hgvs-notation">
        <span v-if="isFullVariant && (variant as Variant).transcript" class="text-grey">
          {{ (variant as Variant).transcript }}<template v-if="variant.cdna">:</template>
        </span>
        <template v-if="variant.cdna">{{ variant.cdna }}</template>
        <template v-if="variant.aa_change"> {{ ' ' }}{{ variant.aa_change }} </template>
      </span>
      <v-btn v-if="variant.cdna" icon size="x-small" variant="text" class="ml-2" @click="copyHgvs">
        <v-icon size="small" :icon="hgvsCopied ? mdiCheck : mdiContentCopy" />
      </v-btn>
    </div>

    <!-- Genomic position + alleles -->
    <div class="d-flex align-center">
      <span class="genomic-coordinate">{{ variant.chr }}:{{ formatPosition(variant.pos) }}</span>
      <span class="variant-data-mono ml-1">{{ variant.ref }} &gt; {{ variant.alt }}</span>
      <v-tooltip location="top">
        <template #activator="{ props: tooltipProps }">
          <v-btn
            v-bind="tooltipProps"
            icon
            size="x-small"
            variant="text"
            class="ml-2"
            @click="copyVariant"
          >
            <v-icon size="small" :icon="variantCopied ? mdiCheck : mdiContentCopy" />
          </v-btn>
        </template>
        Copy chr:pos:ref:alt
      </v-tooltip>
    </div>

    <!-- rsID - From VEP colocated_variants -->
    <div class="d-flex align-center mt-2">
      <span class="text-body-small text-grey">rsID:</span>
      <template v-if="rsId">
        <span class="ml-1 variant-data-mono">{{ rsId }}</span>
        <v-btn icon size="x-small" variant="text" class="ml-2" @click="copyRsId">
          <v-icon size="small" :icon="rsIdCopied ? mdiCheck : mdiContentCopy" />
        </v-btn>
      </template>
      <span v-else class="ml-1 text-grey">N/A</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useClipboard } from '../composables/useClipboard'
import type { Variant } from '../../../shared/types/api'
import type { CohortVariant } from '../../../shared/types/cohort'
import type { VepColocatedVariant } from '../../../main/services/api/schemas/vep-response'
import { mdiCheck, mdiContentCopy, mdiDna } from '@mdi/js'

interface Props {
  variant: Variant | CohortVariant
  colocatedVariants?: VepColocatedVariant[]
}

const props = withDefaults(defineProps<Props>(), {
  colocatedVariants: () => []
})

const emit = defineEmits<{
  'open-protein-view': []
}>()

/**
 * Check if variant is a full Variant (not CohortVariant)
 */
const isFullVariant = computed(() => {
  return 'transcript' in props.variant
})

// Create separate clipboard instances for each copy operation
const { copy: copyHgvsText, copied: hgvsCopied } = useClipboard()
const { copy: copyVariantText, copied: variantCopied } = useClipboard()
const { copy: copyRsIdText, copied: rsIdCopied } = useClipboard()

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
 * Copy HGVS notation to clipboard
 */
async function copyHgvs(): Promise<void> {
  if (props.variant.cdna !== null && props.variant.cdna !== '') {
    const transcript = isFullVariant.value ? (props.variant as Variant).transcript : null
    let text =
      transcript !== null && transcript !== undefined && transcript !== ''
        ? `${transcript}:${props.variant.cdna}`
        : props.variant.cdna
    if (props.variant.aa_change !== null && props.variant.aa_change !== '') {
      text += ` ${props.variant.aa_change}`
    }
    await copyHgvsText(text)
  }
}

/**
 * Copy full variant notation (chr:pos:ref:alt) to clipboard
 */
async function copyVariant(): Promise<void> {
  const variantNotation = `${props.variant.chr}:${props.variant.pos}:${props.variant.ref}:${props.variant.alt}`
  await copyVariantText(variantNotation)
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
.hgvs-notation {
  font-family: 'Courier New', Courier, monospace;
  font-size: 0.875rem;
}

.genomic-coordinate {
  font-family: 'Courier New', Courier, monospace;
  font-size: 0.875rem;
  color: rgb(var(--v-theme-primary));
}

.variant-data-mono {
  font-family: 'Courier New', Courier, monospace;
  font-size: 0.875rem;
}
</style>
