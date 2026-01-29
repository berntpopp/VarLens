<template>
  <v-dialog v-model="open" max-width="600px">
    <template #activator="{ props }">
      <v-btn v-bind="props" variant="tonal" size="small" prepend-icon="mdi-information-outline">
        Case Info
      </v-btn>
    </template>

    <v-card>
      <v-card-title class="d-flex align-center justify-space-between">
        <span>{{ caseName }} - Metadata</span>
        <v-btn icon="mdi-close" variant="text" size="small" @click="open = false" />
      </v-card-title>

      <v-divider />

      <v-card-text class="pa-4">
        <CaseMetadataCard :case-id="caseId" />
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import CaseMetadataCard from './CaseMetadataCard.vue'

defineProps<{
  caseId: number
  caseName: string
}>()

const open = ref(false)
</script>
