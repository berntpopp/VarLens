<template>
  <div class="background-jobs" data-testid="background-jobs">
    <!-- Screen-reader progress: start, every 25 %, and the outcome — not every tick. -->
    <div class="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
      {{ announcement }}
    </div>

    <v-card
      v-if="jobs.length > 0"
      class="background-jobs__card"
      elevation="6"
      role="region"
      aria-labelledby="background-jobs-title"
    >
      <div id="background-jobs-title" class="text-subtitle-2 px-4 pt-3 pb-1">Background tasks</div>
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
              :aria-label="`Cancel ${labelOf(job)}`"
              @click="cancel(job.id)"
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
            {{ describeJob(job) }}
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
import { ref, watch } from 'vue'
import { mdiClose } from '@mdi/js'

import type { Job, JobKind } from '../../../../shared/types/jobs'
import {
  JOB_KIND_LABELS,
  describeJob,
  isActiveJob,
  jobPercent,
  useBackgroundJobs
} from '../../composables/useBackgroundJobs'
import { useAuthStore } from '../../stores/authStore'

const props = defineProps<{
  /** Only show these job kinds (default: all). */
  kinds?: readonly JobKind[]
}>()

const { jobs, cancel, dismiss, cancelErrors, cancelling } = useBackgroundJobs({
  kinds: props.kinds
})
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

const announcement = ref('')
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
      else if (percent !== null) announcement.value = `${labelOf(job)} ${percent}% done.`
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

.background-jobs__list {
  list-style: none;
  margin: 0;
  padding: 0 0 8px;
}

.background-jobs__item + .background-jobs__item {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
