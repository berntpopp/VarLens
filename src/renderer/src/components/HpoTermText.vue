<template>
  <!-- One inline span: inside a flex chip a bare text node would lose the space after "no". -->
  <span
    >{{ term.excluded ? COPY.excludedPrefix : ''
    }}<span :class="{ 'text-decoration-line-through': term.excluded }">{{
      hpoTermLabel(term)
    }}</span></span
  >
</template>

<script setup lang="ts">
// Chip text for a case HPO term: excluded terms read "no <label>" with the label struck through.
import type { CaseHpoTerm } from '../../../shared/types/api'
import { HPO_TERM_COPY as COPY } from '../config/hpoTermCopy'
import { hpoTermLabel } from '../utils/hpo-term-status'

defineProps<{ term: Pick<CaseHpoTerm, 'hpo_id' | 'hpo_label' | 'excluded'> }>()
</script>
