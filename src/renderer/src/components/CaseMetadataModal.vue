<template>
  <v-dialog v-model="open" max-width="700px" scrollable>
    <v-card>
      <v-card-title class="d-flex align-center justify-space-between">
        <span>{{ caseName }}</span>
        <v-btn
          aria-label="Close"
          :icon="mdiClose"
          variant="text"
          size="small"
          @click="open = false"
        />
      </v-card-title>

      <v-divider />

      <div class="d-flex ga-4 px-4 py-2 text-body-medium text-medium-emphasis bg-grey-lighten-4">
        <span>
          <v-icon size="x-small" class="mr-1" :icon="mdiDna" />
          {{ variantCount.toLocaleString() }} variants
        </span>
        <span>
          <v-icon size="x-small" class="mr-1" :icon="mdiCalendar" />
          Imported {{ formatDate(createdAt) }}
        </span>
      </div>

      <div v-if="isWebMode" class="d-flex bg-secondary">
        <v-btn
          v-for="tab in tabs"
          :key="tab.value"
          :active="currentTab === tab.value"
          :color="currentTab === tab.value ? 'primary' : undefined"
          :prepend-icon="tab.icon"
          variant="text"
          class="metadata-tab-button"
          @click="setActiveTab(tab.value)"
        >
          {{ tab.label }}
          <v-badge
            v-if="tab.value === 'comments' && commentCount > 0"
            :content="commentCount"
            color="primary"
            inline
            class="ml-1"
          />
          <v-badge
            v-if="tab.value === 'metrics' && metricCount > 0"
            :content="metricCount"
            color="primary"
            inline
            class="ml-1"
          />
        </v-btn>
      </div>
      <v-tabs v-else v-model="activeTab" bg-color="secondary" density="compact">
        <v-tab value="overview">
          <v-icon start size="small" :icon="mdiInformationOutline" />
          Overview
        </v-tab>
        <v-tab value="comments">
          <v-icon start size="small" :icon="mdiCommentTextOutline" />
          Comments
          <v-badge
            v-if="commentCount > 0"
            :content="commentCount"
            color="primary"
            inline
            class="ml-1"
          />
        </v-tab>
        <v-tab value="metrics">
          <v-icon start size="small" :icon="mdiChartBoxOutline" />
          Metrics
          <v-badge
            v-if="metricCount > 0"
            :content="metricCount"
            color="primary"
            inline
            class="ml-1"
          />
        </v-tab>
        <v-tab value="data">
          <v-icon start size="small" :icon="mdiDatabaseOutline" />
          Data Info
        </v-tab>
      </v-tabs>

      <v-card-text
        class="pa-4"
        style="min-height: 300px; max-height: 500px; overflow-y: auto"
        :data-active-tab="currentTab"
      >
        <template v-if="isWebMode">
          <div v-if="currentTab === 'overview'" data-testid="metadata-overview-pane">
            <CaseMetadataCard :case-id="caseId" @changed="emit('metadata-changed')" />
          </div>
          <div v-else-if="currentTab === 'comments'" data-testid="metadata-comments-pane">
            <CaseCommentsTab :case-id="caseId" />
          </div>
          <div v-else-if="currentTab === 'metrics'" data-testid="metadata-metrics-pane">
            <CaseMetricsTab :case-id="caseId" />
          </div>
          <div v-else-if="currentTab === 'data'" data-testid="metadata-data-pane">
            <CaseDataInfoTab :key="`data-${caseId}`" :case-id="caseId" />
          </div>
        </template>

        <v-tabs-window v-else v-model="activeTab">
          <v-tabs-window-item value="overview">
            <CaseMetadataCard :case-id="caseId" @changed="emit('metadata-changed')" />
          </v-tabs-window-item>
          <v-tabs-window-item value="comments">
            <CaseCommentsTab :case-id="caseId" />
          </v-tabs-window-item>
          <v-tabs-window-item value="metrics">
            <CaseMetricsTab :case-id="caseId" />
          </v-tabs-window-item>
          <v-tabs-window-item value="data">
            <CaseDataInfoTab :case-id="caseId" />
          </v-tabs-window-item>
        </v-tabs-window>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import CaseMetadataCard from './CaseMetadataCard.vue'
import CaseCommentsTab from './CaseCommentsTab.vue'
import CaseMetricsTab from './CaseMetricsTab.vue'
import CaseDataInfoTab from './CaseDataInfoTab.vue'
import { useCaseComments } from '../composables/useCaseComments'
import { useCaseMetrics } from '../composables/useCaseMetrics'
import { isWebRuntime } from '../utils/runtime-mode'
import {
  mdiCalendar,
  mdiChartBoxOutline,
  mdiClose,
  mdiCommentTextOutline,
  mdiDatabaseOutline,
  mdiDna,
  mdiInformationOutline
} from '@mdi/js'

const props = defineProps<{
  caseId: number
  caseName: string
  variantCount: number
  createdAt: number
}>()

const emit = defineEmits<{
  'metadata-changed': []
}>()

const open = ref(false)
type MetadataTab = 'overview' | 'comments' | 'metrics' | 'data'
const metadataTabs = new Set<MetadataTab>(['overview', 'comments', 'metrics', 'data'])
const activeTab = ref<MetadataTab | MetadataTab[]>('overview')
const isWebMode = isWebRuntime()
const tabs: Array<{ value: MetadataTab; label: string; icon: string }> = [
  { value: 'overview', label: 'Overview', icon: mdiInformationOutline },
  { value: 'comments', label: 'Comments', icon: mdiCommentTextOutline },
  { value: 'metrics', label: 'Metrics', icon: mdiChartBoxOutline },
  { value: 'data', label: 'Data Info', icon: mdiDatabaseOutline }
]

// The tab badges read the tabs' own queries, while the modal is open.
const openCaseId = (): number => (open.value ? props.caseId : 0)
const { comments } = useCaseComments(openCaseId)
const { metrics } = useCaseMetrics(openCaseId)

const commentCount = computed(() => comments.value.length)
const metricCount = computed(() => metrics.value.length)
const currentTab = computed<MetadataTab>(() => {
  const value = Array.isArray(activeTab.value) ? activeTab.value[0] : activeTab.value
  return metadataTabs.has(value) ? value : 'overview'
})

const formatDate = (timestamp: number): string => {
  if (timestamp === 0) return 'Unknown'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(timestamp))
}

const show = (): void => {
  open.value = true
}

function setActiveTab(tab: unknown): void {
  if (typeof tab === 'string' && metadataTabs.has(tab as MetadataTab)) {
    activeTab.value = tab as MetadataTab
  }
}

defineExpose({ show })
</script>
