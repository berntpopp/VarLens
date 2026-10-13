<template>
  <!-- Legend glyph of a ClinVar class: the plot marker's shape (#572). -->
  <svg class="clinvar-mark" width="10" height="10" viewBox="-5 -5 10 10" aria-hidden="true">
    <path :d="clinvarMarkPath(cls, 36)" :fill="color ?? 'currentColor'" />
  </svg>
</template>

<script setup lang="ts">
import type { ClinVarSignificance } from '../../../../shared/types/protein'
import { clinvarMarkPath } from '../../utils/clinvar-mark'

/** Without `color` the mark takes the text colour (readable on a filled chip). */
defineProps<{ cls: ClinVarSignificance; color?: string }>()
</script>

<style scoped>
.clinvar-mark {
  flex-shrink: 0;
  vertical-align: -1px;
}
</style>
