<template>
  <v-dialog v-model="isOpen" max-width="800" scrollable>
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon class="mr-2" :icon="mdiChartBoxOutline" />
        Database Overview
        <v-spacer />
        <v-btn
          aria-label="Close"
          :icon="mdiClose"
          variant="text"
          size="small"
          @click="isOpen = false"
        />
      </v-card-title>
      <v-divider />
      <v-card-text>
        <v-progress-linear v-if="loading" indeterminate class="mb-4" />

        <template v-else-if="overview">
          <OverviewStatsGrid :summary="overview.summary" />

          <OverviewCohortSection :cohort-groups="overview.cohortGroups" @refresh="loadOverview" />

          <OverviewTagsSection :tags="overview.tags" @refresh="loadOverview" />

          <OverviewPhenotypesSection :phenotypes="overview.topPhenotypes" />
        </template>

        <!-- Error / empty fallback -->
        <div v-else-if="error" class="text-error text-body-medium py-4">
          <v-icon size="small" class="mr-1" :icon="mdiAlertCircle" />
          {{ error }}
        </div>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import type { DatabaseOverview } from '../../../shared/types/database-overview'
import { useApiService } from '../composables/useApiService'
import OverviewStatsGrid from './database-overview/OverviewStatsGrid.vue'
import OverviewCohortSection from './database-overview/OverviewCohortSection.vue'
import OverviewTagsSection from './database-overview/OverviewTagsSection.vue'
import OverviewPhenotypesSection from './database-overview/OverviewPhenotypesSection.vue'
import { mdiAlertCircle, mdiChartBoxOutline, mdiClose } from '@mdi/js'
import { logService } from '../services/LogService'
import { isIpcError, unwrapIpcResult } from '../../../shared/types/errors'
import { getCurrentUnsupportedReason } from '../utils/backend-capabilities'

const { api } = useApiService()

const isOpen = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)
const overview = ref<DatabaseOverview | null>(null)

async function getOverviewBlockReason(): Promise<string | null> {
  return getCurrentUnsupportedReason('cases.overview')
}

/** Load overview data from the database IPC endpoint */
async function loadOverview(): Promise<void> {
  // Guard for browser dev mode (no preload)
  if (!api) {
    return
  }

  error.value = null
  const reason = await getOverviewBlockReason()
  if (reason !== null) {
    logService.warn(reason, 'backend-capabilities')
    overview.value = null
    error.value = reason
    return
  }

  loading.value = true
  try {
    const data = unwrapIpcResult(await api.database.getOverview())
    // Normalize: ensure new annotation fields have safe defaults
    if (data.summary.starred_variants === undefined) {
      data.summary.starred_variants = 0
    }
    if (data.summary.acmg_counts === undefined) {
      data.summary.acmg_counts = {
        pathogenic: 0,
        likely_pathogenic: 0,
        vus: 0,
        likely_benign: 0,
        benign: 0
      }
    }
    overview.value = data
  } catch (err) {
    logService.error(
      'Failed to load database overview: ' +
        (err instanceof Error
          ? err.message
          : isIpcError(err)
            ? (err.userMessage ?? err.message)
            : String(err)),
      'database'
    )
    error.value = 'Failed to load database overview.'
  } finally {
    loading.value = false
  }
}

// Load data when dialog opens
watch(isOpen, async (open) => {
  if (open) {
    await loadOverview()
  }
})

const show = (): void => {
  isOpen.value = true
}

defineExpose({ show })
</script>
