<template>
  <v-container class="fill-height d-flex align-center flex-wrap">
    <v-row class="align-center justify-center">
      <v-col cols="12" sm="8" md="6" class="text-center">
        <v-icon size="220" class="mb-4" icon="custom:varlens-dna" />
        <h2 class="text-headline-large font-weight-medium text-high-emphasis">
          Welcome to VarLens
        </h2>
        <p class="text-body-large mt-3 text-medium-emphasis">
          Analyze genetic variants with a data-dense interface designed for research analysis.
        </p>

        <v-divider class="my-6 mx-auto" style="max-width: 200px" />

        <!-- Fixed-height slot: the case count arrives after first paint, and
             swapping "Import" (tall) for "Select a case" (short) inside a
             vertically-centred row shifted the whole block (CLS ~0.18). Render
             nothing until the case list has answered, in reserved space. -->
        <div class="empty-state__cta" :aria-busy="!casesLoaded">
          <template v-if="casesLoaded && hasCases">
            <p class="text-body-medium text-muted">
              <v-icon size="small" class="mr-1" :icon="mdiArrowLeft" />
              Select a case from the sidebar to view variants
            </p>
          </template>
          <template v-else-if="casesLoaded && allowImport">
            <p class="text-body-medium text-muted mb-4">
              Get started by importing your first variant file
            </p>
            <v-btn color="primary" size="large" :prepend-icon="mdiUpload" @click="$emit('import')">
              Import Variants
            </v-btn>
            <p class="text-body-small text-muted mt-4">
              Supports VCF and JSON files (.vcf, .vcf.gz, .json, .json.gz), whole folders and ZIP
              archives
            </p>
          </template>
          <template v-else-if="casesLoaded">
            <p class="text-body-medium text-muted">No cases are available in this workspace yet.</p>
          </template>
        </div>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue'
import { mdiArrowLeft, mdiUpload } from '@mdi/js'
import { AppStateKey } from '../composables/useAppState'
withDefaults(
  defineProps<{
    hasCases?: boolean
    allowImport?: boolean
  }>(),
  {
    allowImport: true
  }
)

defineEmits<{
  import: []
}>()

// Optional injection: outside the app shell (isolated tests) treat the list as loaded.
const appState = inject(AppStateKey, null)
const casesLoaded = computed(() => appState?.casesLoaded.value ?? true)
</script>

<style scoped>
/* Reserved height for the tallest variant (import CTA: hint + large button +
   a format note that may wrap to two lines on narrow columns). */
.empty-state__cta {
  min-height: 172px;
}
</style>
