<template>
  <div class="variant-identity-section">
    <div class="d-flex align-center mb-2">
      <h3 class="text-title-large">{{ title }}</h3>
      <IconButton
        v-if="variant.gene_symbol"
        label="Open protein view"
        :icon="mdiDna"
        size="x-small"
        tooltip-location="top"
        class="ml-1"
        @click="emit('open-protein-view')"
      />
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
        @click="copyHgvsText(hgvsText)"
      />
    </div>

    <!-- Genomic position + alleles -->
    <div class="d-flex align-center">
      <span class="genomic-coordinate">{{ variant.chr }}:{{ formatPosition(variant.pos) }}</span>
      <span class="variant-data-mono ml-1">{{ variant.ref }} &gt; {{ variant.alt }}</span>
      <IconButton
        :label="variantCopied ? 'Variant copied' : 'Copy chr:pos:ref:alt'"
        :icon="variantCopied ? mdiCheck : mdiContentCopy"
        size="x-small"
        tooltip-location="top"
        class="ml-2"
        @click="copyVariant"
      />
    </div>

    <!-- rsID - From VEP colocated_variants -->
    <div class="d-flex align-center mt-2">
      <span class="text-body-small text-muted">rsID:</span>
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
import { computed } from 'vue'
import { useClipboard } from '../composables/useClipboard'
import type { Variant } from '../../../shared/types/api'
import type { CohortVariant } from '../../../shared/types/cohort'
import type { VepColocatedVariant } from '../../../shared/types/vep'
import { mdiCheck, mdiContentCopy, mdiDna } from '@mdi/js'
import IconButton from './common/IconButton.vue'
import { formatHgvs, variantName } from '../utils/formatters'

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
