<template>
  <div>
    <div class="d-flex gap-2 mb-4">
      <v-chip color="success" variant="flat">
        <v-icon start>mdi-check-circle</v-icon>
        Succeeded: {{ summary.succeeded }}
      </v-chip>
      <v-chip v-if="summary.failed > 0" color="error" variant="flat">
        <v-icon start>mdi-alert-circle</v-icon>
        Failed: {{ summary.failed }}
      </v-chip>
      <v-chip v-if="summary.skipped > 0" color="secondary" variant="flat">
        <v-icon start>mdi-skip-next</v-icon>
        Skipped: {{ summary.skipped }}
      </v-chip>
    </div>

    <v-alert v-if="summary.cancelled" type="info" class="mb-4">
      Import was cancelled. {{ summary.succeeded }} files were imported before cancellation.
    </v-alert>

    <v-expansion-panels v-if="summary.details.length > 0" variant="accordion">
      <v-expansion-panel v-for="(detail, i) in summary.details" :key="i">
        <v-expansion-panel-title>
          <div class="d-flex align-center gap-2">
            <v-icon v-if="detail.status === 'success'" color="success" size="small">
              mdi-check-circle
            </v-icon>
            <v-icon v-else-if="detail.status === 'failed'" color="error" size="small">
              mdi-alert-circle
            </v-icon>
            <v-icon v-else color="secondary" size="small"> mdi-skip-next </v-icon>
            <span>{{ detail.fileName }}</span>
            <span v-if="detail.variantCount !== undefined" class="text-body-small ml-2">
              ({{ detail.variantCount.toLocaleString() }} variants)
            </span>
          </div>
        </v-expansion-panel-title>
        <v-expansion-panel-text>
          <div v-if="detail.status === 'success'">
            <strong>Case:</strong> {{ detail.caseName }}<br />
            <strong>Variants:</strong> {{ detail.variantCount?.toLocaleString() }} imported
          </div>
          <div v-else-if="detail.status === 'failed'">
            <strong>Error:</strong> {{ detail.error }}
          </div>
          <div v-else><strong>Reason:</strong> {{ detail.error ?? 'Skipped' }}</div>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
  </div>
</template>

<script setup lang="ts">
import type { BatchResult } from '../../../../shared/types/api'

defineProps<{
  summary: BatchResult
}>()
</script>
