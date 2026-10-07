<template>
  <div class="background-jobs" data-testid="background-jobs">
    <!-- Screen-reader progress: start, every 25 %, and the outcome — not every tick. -->
    <div class="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
      {{ announcement }}
    </div>

    <!-- Collapsed by default: the footer's BackgroundJobsToggle opens this card,
         so it only covers the table's pagination footer while the user wants it. -->
    <v-card
      v-if="jobs.length > 0 && panelExpanded"
      :id="BACKGROUND_JOBS_PANEL_ID"
      class="background-jobs__card"
      elevation="6"
      role="region"
      aria-labelledby="background-jobs-title"
      tabindex="-1"
      @keydown.esc.stop="collapse"
    >
      <div class="d-flex align-center pl-4 pr-2 pt-2 pb-1">
        <div id="background-jobs-title" class="text-subtitle-2">Background tasks</div>
        <v-spacer />
        <IconButton
          label="Collapse background tasks"
          :icon="mdiChevronDown"
          size="small"
          @click="collapse"
        />
      </div>
      <ul class="background-jobs__list">
        <li
          v-for="job in jobs"
          :key="job.id"
          class="background-jobs__item px-4 py-2"
          :data-testid="`background-job-${job.kind}`"
        >
          <div class="d-flex align-center ga-2">
            <span class="text-body-2 font-weight-medium text-truncate">
              {{ labelOf(job) }}
            </span>
            <v-spacer />
            <v-btn
              v-if="isActiveJob(job)"
              size="small"
              variant="text"
              color="error"
              :loading="cancelling[job.id] === true"
              :disabled="cancelRequested[job.id] === true"
              :aria-label="`Cancel ${labelOf(job)}`"
              @click="requestCancel(job)"
            >
              Cancel
            </v-btn>
            <v-btn
              v-else
              size="small"
              variant="text"
              :icon="mdiClose"
              :aria-label="`Dismiss ${labelOf(job)}`"
              @click="dismiss(job.id)"
            />
          </div>
          <v-progress-linear
            v-if="isActiveJob(job)"
            :model-value="jobPercent(job) ?? 0"
            :indeterminate="jobPercent(job) === null"
            :aria-label="`${labelOf(job)} progress`"
            color="primary"
            height="6"
            rounded
            class="my-1"
          />
          <div class="text-caption" :class="statusClass(job)">
            {{ statusText(job) }}
            <template v-if="ownerNote(job)"> · {{ ownerNote(job) }}</template>
          </div>
          <div v-if="cancelErrors[job.id]" class="text-caption text-error" role="alert">
            {{ cancelErrors[job.id] }}
          </div>
        </li>
      </ul>
    </v-card>
  </div>
</template>

<script setup lang="ts">
/**
 * Reusable progress + cancel surface for background jobs (export, case
 * delete, import, …). Rendered once by the app shell, so it is visible in
 * the case view, the cohort view and the case list, on desktop and in web.
 * `kinds` narrows it to a subset when embedded in a specific context.
 */
import { nextTick, ref, watch } from 'vue'
import { mdiChevronDown, mdiClose } from '@mdi/js'

import type { Job, JobKind } from '../../../../shared/types/jobs'
import {
  JOB_KIND_LABELS,
  describeJob,
  isActiveJob,
  jobPercent,
  useBackgroundJobs
} from '../../composables/useBackgroundJobs'
import { useAuthStore } from '../../stores/authStore'
import IconButton from '../common/IconButton.vue'
import { BACKGROUND_JOBS_PANEL_ID, BACKGROUND_JOBS_TOGGLE_ID } from './background-jobs-ids'

const props = defineProps<{
  /** Only show these job kinds (default: all). */
  kinds?: readonly JobKind[]
}>()

const {
  jobs,
  cancel,
  dismiss,
  cancelErrors,
  cancelling,
  cancelRequested,
  panelExpanded,
  setPanelExpanded
} = useBackgroundJobs({ kinds: props.kinds })
const authStore = useAuthStore()

function labelOf(job: Job): string {
  return JOB_KIND_LABELS[job.kind] ?? job.kind
}

/** Admins see other users' jobs (web); say whose it is. */
function ownerNote(job: Job): string | null {
  const owner = job.owner
  if (owner === undefined || owner.username === authStore.currentUser?.username) return null
  return `started by ${owner.username}`
}

function statusClass(job: Job): string {
  if (job.status === 'failed') return 'text-error'
  if (job.status === 'completed') return 'text-success'
  return 'text-medium-emphasis'
}

/** Cancellation is cooperative: say so until the worker has actually stopped. */
function statusText(job: Job): string {
  return isActiveJob(job) && cancelRequested.value[job.id] === true
    ? 'Cancelling…'
    : describeJob(job)
}

const announcement = ref('')

async function requestCancel(job: Job): Promise<void> {
  await cancel(job.id)
  if (cancelRequested.value[job.id] === true) announcement.value = `${labelOf(job)}: cancelling.`
}

/** Collapse back to the footer toggle and hand focus back to it. */
async function collapse(): Promise<void> {
  setPanelExpanded(false)
  await nextTick()
  document.getElementById(BACKGROUND_JOBS_TOGGLE_ID)?.focus()
}
const announced = new Map<string, string>()

function milestone(job: Job): string {
  if (!isActiveJob(job)) return job.status
  const percent = jobPercent(job)
  return percent === null ? 'running' : `p${Math.floor(percent / 25) * 25}`
}

watch(
  jobs,
  (current) => {
    for (const job of current) {
      const key = milestone(job)
      if (announced.get(job.id) === key) continue
      const first = !announced.has(job.id)
      announced.set(job.id, key)
      const percent = jobPercent(job)
      if (first && isActiveJob(job)) announcement.value = `${labelOf(job)} started.`
      else if (!isActiveJob(job)) announcement.value = `${labelOf(job)}: ${describeJob(job)}.`
      else if (percent !== null && percent > 0) {
        announcement.value = `${labelOf(job)} ${percent}% done.`
      }
    }
  },
  { deep: true }
)
</script>

<style scoped>
.background-jobs__card {
  position: fixed;
  right: 16px;
  bottom: 48px;
  z-index: 2000;
  width: min(360px, calc(100vw - 32px));
  max-height: 50vh;
  overflow-y: auto;
}

/* Focused programmatically when expanded from the footer toggle. */
.background-jobs__card:focus {
  outline: none;
}

.background-jobs__list {
  list-style: none;
  margin: 0;
  padding: 0 0 8px;
}

.background-jobs__item + .background-jobs__item {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
