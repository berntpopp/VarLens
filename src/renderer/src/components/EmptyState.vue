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

        <!-- Show different content based on whether cases exist -->
        <template v-if="hasCases">
          <p class="text-body-medium text-muted">
            <v-icon size="small" class="mr-1" :icon="mdiArrowLeft" />
            Select a case from the sidebar to view variants
          </p>
        </template>
        <template v-else-if="allowImport">
          <p class="text-body-medium text-muted mb-4">
            Get started by importing your first variant file
          </p>
          <v-btn color="primary" size="large" :prepend-icon="mdiUpload" @click="$emit('import')">
            Import Variants
          </v-btn>
          <p class="text-body-small text-muted mt-4">Supports .json and .json.gz files</p>
          <div class="mt-4">
            <v-icon size="small" class="mr-1" :icon="mdiTrayArrowDown" />
            <span class="text-body-small text-muted">or drag and drop files here</span>
          </div>
        </template>
        <template v-else>
          <p class="text-body-medium text-muted">No cases are available in this workspace yet.</p>
        </template>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup lang="ts">
import { mdiArrowLeft, mdiTrayArrowDown, mdiUpload } from '@mdi/js'
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
</script>
