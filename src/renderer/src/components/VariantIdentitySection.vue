<template>
  <div class="variant-identity-section">
    <div class="text-h6 mb-2">{{ variant.gene_symbol ?? 'Unknown Gene' }}</div>

    <div
      v-if="isFullVariant && (variant as Variant).transcript"
      class="text-caption text-grey mb-1"
    >
      {{ (variant as Variant).transcript }}
    </div>

    <!-- cDNA / HGVS -->
    <div v-if="variant.cdna" class="d-flex align-center mb-1">
      <span class="hgvs-notation">{{ variant.cdna }}</span>
      <v-btn icon size="x-small" variant="text" @click="copyHgvs">
        <v-icon size="small">{{ hgvsCopied ? 'mdi-check' : 'mdi-content-copy' }}</v-icon>
      </v-btn>
    </div>

    <!-- Protein change -->
    <div v-if="variant.aa_change" class="hgvs-notation mb-2">
      {{ variant.aa_change }}
    </div>

    <!-- Genomic position -->
    <div class="d-flex align-center mb-1">
      <span class="genomic-coordinate">{{ variant.chr }}:{{ formatPosition(variant.pos) }}</span>
      <v-btn icon size="x-small" variant="text" @click="copyPosition">
        <v-icon size="small">{{ positionCopied ? 'mdi-check' : 'mdi-content-copy' }}</v-icon>
      </v-btn>
    </div>

    <!-- Alleles with full variant copy -->
    <div class="d-flex align-center">
      <span class="variant-data-mono">{{ variant.ref }} &gt; {{ variant.alt }}</span>
      <v-tooltip location="top">
        <template #activator="{ props: tooltipProps }">
          <v-btn v-bind="tooltipProps" icon size="x-small" variant="text" @click="copyVariant">
            <v-icon size="small">{{ variantCopied ? 'mdi-check' : 'mdi-content-copy' }}</v-icon>
          </v-btn>
        </template>
        Copy chr:pos:ref:alt
      </v-tooltip>
    </div>

    <!-- rsID - From VEP colocated_variants -->
    <div class="d-flex align-center mt-2">
      <span class="text-caption text-grey">rsID:</span>
      <template v-if="rsId">
        <span class="ml-1 variant-data-mono">{{ rsId }}</span>
        <v-btn icon size="x-small" variant="text" @click="copyRsId">
          <v-icon size="small">{{ rsIdCopied ? 'mdi-check' : 'mdi-content-copy' }}</v-icon>
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

interface Props {
  variant: Variant | CohortVariant
  colocatedVariants?: VepColocatedVariant[]
}

const props = withDefaults(defineProps<Props>(), {
  colocatedVariants: () => []
})

/**
 * Check if variant is a full Variant (not CohortVariant)
 */
const isFullVariant = computed(() => {
  return 'transcript' in props.variant
})

// Create separate clipboard instances for each copy operation
const { copy: copyHgvsText, copied: hgvsCopied } = useClipboard()
const { copy: copyPositionText, copied: positionCopied } = useClipboard()
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
    await copyHgvsText(props.variant.cdna)
  }
}

/**
 * Copy genomic position to clipboard
 */
async function copyPosition(): Promise<void> {
  const position = `${props.variant.chr}:${props.variant.pos}`
  await copyPositionText(position)
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
