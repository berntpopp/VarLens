<template>
  <div>
    <div class="d-flex gap-2 mb-4">
      <v-chip color="success" variant="flat">
        <v-icon start :icon="mdiCheckCircle" />
        Succeeded: {{ summary.succeeded }}
      </v-chip>
      <v-chip v-if="summary.failed > 0" color="error" variant="flat">
        <v-icon start :icon="mdiAlertCircle" />
        Failed: {{ summary.failed }}
      </v-chip>
      <v-chip v-if="summary.skipped > 0" color="secondary" variant="flat">
        <v-icon start :icon="mdiSkipNext" />
        Skipped: {{ summary.skipped }}
      </v-chip>
    </div>

    <v-alert v-if="summary.cancelled" type="info" class="mb-4">
      Import was cancelled. {{ summary.succeeded }} files were imported before cancellation.
    </v-alert>

    <!-- ClinVar values the severity configuration does not know: imported and
         shown as they are, but ranked as unknown (#469). Tonal alert: its
         background derives from the theme's warning colour in light and dark. -->
    <v-alert
      v-for="notice in unrankedNotices"
      :key="notice.caseName"
      type="warning"
      variant="tonal"
      density="compact"
      class="mb-2 text-body-small"
      data-testid="unranked-clinvar"
    >
      <strong>{{ notice.caseName }}:</strong> {{ notice.summary }}
    </v-alert>

    <v-expansion-panels v-if="summary.details.length > 0" variant="accordion">
      <v-expansion-panel v-for="(detail, i) in summary.details" :key="i">
        <v-expansion-panel-title>
          <div class="d-flex align-center gap-2">
            <v-icon
              v-if="detail.status === 'success'"
              color="success"
              size="small"
              :icon="mdiCheckCircle"
            />
            <v-icon
              v-else-if="detail.status === 'failed'"
              color="error"
              size="small"
              :icon="mdiAlertCircle"
            />
            <v-icon v-else color="secondary" size="small" :icon="mdiSkipNext" />
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
import { computed } from 'vue'
import type { BatchResult } from '../../../../shared/types/api'
import { unrankedClinvarSummary } from '../../utils/unranked-clinvar'
import { mdiAlertCircle, mdiCheckCircle, mdiSkipNext } from '@mdi/js'

const props = defineProps<{
  summary: BatchResult
}>()

/** One compact warning per file that had ClinVar values the configuration does not know. */
const unrankedNotices = computed(() =>
  props.summary.details.flatMap((detail) =>
    detail.unrankedClinvar !== undefined && detail.unrankedClinvar.length > 0
      ? [{ caseName: detail.caseName, summary: unrankedClinvarSummary(detail.unrankedClinvar) }]
      : []
  )
)
</script>
