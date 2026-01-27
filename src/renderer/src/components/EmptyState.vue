<template>
  <v-container class="fill-height">
    <v-row align="center" justify="center">
      <v-col cols="12" sm="8" md="6" class="text-center">
        <v-icon size="96" color="primary" class="mb-4" icon="custom:varlens-dna" />
        <h2 class="text-h4 font-weight-medium text-grey-darken-2">Welcome to VarLens</h2>
        <p class="text-body-1 mt-3 text-grey-darken-1">
          Analyze genetic variants with a data-dense interface designed for research analysis.
        </p>

        <v-divider class="my-6 mx-auto" style="max-width: 200px" />

        <!-- Show different content based on whether cases exist -->
        <template v-if="hasCases">
          <p class="text-body-2 text-grey">
            <v-icon size="small" class="mr-1">mdi-arrow-left</v-icon>
            Select a case from the sidebar to view variants
          </p>
        </template>
        <template v-else>
          <p class="text-body-2 text-grey mb-4">Get started by importing your first variant file</p>
          <v-btn color="primary" size="large" prepend-icon="mdi-upload" @click="$emit('import')">
            Import Variants
          </v-btn>
          <p class="text-caption text-grey mt-4">Supports .json and .json.gz files</p>
        </template>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup lang="ts">
defineProps<{
  hasCases?: boolean
}>()

defineEmits<{
  import: []
}>()
</script>
