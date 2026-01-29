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

    <!-- rsID - Not available in current schema, will come from VEP enrichment in Phase 21 -->
    <div class="d-flex align-center mt-2">
      <span class="text-caption text-grey">rsID:</span>
      <span class="ml-1 text-grey">N/A</span>
      <v-tooltip location="top">
        <template #activator="{ props: tooltipProps }">
          <v-icon v-bind="tooltipProps" size="x-small" class="ml-1 text-grey"
            >mdi-information-outline</v-icon
          >
        </template>
        rsID will be available with VEP enrichment (Phase 21)
      </v-tooltip>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useClipboard } from '../composables/useClipboard'
import type { Variant } from '../../../shared/types/api'
import type { CohortVariant } from '../../../shared/types/cohort'

interface Props {
  variant: Variant | CohortVariant
}

const props = defineProps<Props>()

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
