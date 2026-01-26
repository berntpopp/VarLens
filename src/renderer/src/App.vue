<template>
  <v-app>
    <AppSidebar>
      <!-- Case list slot placeholder - will be populated in Plan 02 -->
      <v-list density="compact">
        <v-list-item title="Cases will appear here" />
      </v-list>
    </AppSidebar>

    <v-main>
      <!-- Conditional: EmptyState when no case selected, variant table later -->
      <EmptyState v-if="!selectedCaseId" />
      <!-- Future: VariantTable when case selected -->
    </v-main>
  </v-app>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import AppSidebar from './components/AppSidebar.vue'
import EmptyState from './components/EmptyState.vue'

// Case selection state - will be connected to CaseList events in Plan 02
const selectedCaseId = ref<number | null>(null)
</script>
