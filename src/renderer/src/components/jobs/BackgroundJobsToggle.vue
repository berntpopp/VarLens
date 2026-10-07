<template>
  <v-btn
    v-if="jobs.length > 0"
    :id="BACKGROUND_JOBS_TOGGLE_ID"
    variant="text"
    size="small"
    class="background-jobs-toggle text-body-small ml-1"
    data-testid="background-jobs-toggle"
    :aria-label="`Background tasks: ${summary}`"
    :aria-expanded="panelExpanded"
    :aria-controls="BACKGROUND_JOBS_PANEL_ID"
    @click="toggle"
  >
    <v-progress-circular
      v-if="anyActive"
      indeterminate
      size="12"
      width="2"
      class="mr-2"
      aria-hidden="true"
    />
    <v-icon v-else-if="anyFailed" :icon="mdiAlertCircle" color="error" size="small" class="mr-1" />
    <v-icon v-else :icon="mdiCheckCircleOutline" size="small" class="mr-1" />
    <span class="text-truncate">{{ summary }}</span>
    <v-icon :icon="panelExpanded ? mdiChevronDown : mdiChevronUp" size="small" class="ml-1" />
  </v-btn>
</template>

<script setup lang="ts">
/**
 * Compact footer entry for background jobs. The job list itself
 * (BackgroundJobsPanel) floats over the bottom-right corner of the view, where
 * it covers the data table's pagination footer, so it stays collapsed until
 * the user opens it here (or a job fails). Rendered only while jobs exist.
 */
import { computed, nextTick } from 'vue'
import { mdiAlertCircle, mdiCheckCircleOutline, mdiChevronDown, mdiChevronUp } from '@mdi/js'

import { isActiveJob, summarizeJobs, useBackgroundJobs } from '../../composables/useBackgroundJobs'
import { BACKGROUND_JOBS_PANEL_ID, BACKGROUND_JOBS_TOGGLE_ID } from './background-jobs-ids'

const { jobs, panelExpanded, setPanelExpanded } = useBackgroundJobs()

const summary = computed(() => summarizeJobs(jobs.value))
const anyActive = computed(() => jobs.value.some(isActiveJob))
const anyFailed = computed(() => jobs.value.some((job) => job.status === 'failed'))

async function toggle(): Promise<void> {
  const expand = !panelExpanded.value
  setPanelExpanded(expand)
  if (!expand) return
  // The list is not adjacent in the DOM, so move focus into it.
  await nextTick()
  document.getElementById(BACKGROUND_JOBS_PANEL_ID)?.focus()
}
</script>

<style scoped>
.background-jobs-toggle {
  max-width: 220px;
  text-transform: none;
}
</style>
