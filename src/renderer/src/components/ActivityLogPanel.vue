<template>
  <div class="activity-log-panel">
    <div class="text-title-small mb-2">Activity Log</div>

    <div v-if="loading" class="d-flex justify-center py-4">
      <v-progress-circular indeterminate size="24" />
    </div>

    <div v-else-if="entries.length === 0" class="text-body-2 text-grey py-2">
      No activity recorded yet.
    </div>

    <v-timeline v-else density="compact" side="end">
      <v-timeline-item
        v-for="entry in entries"
        :key="entry.id"
        :dot-color="getActionColor(entry.action_type)"
        size="x-small"
      >
        <div class="text-body-2">
          <span class="font-weight-medium">{{ formatAction(entry.action_type) }}</span>
          <span v-if="entry.user_name" class="text-grey ml-1">by {{ entry.user_name }}</span>
        </div>
        <div class="text-body-small text-grey">
          {{ formatTimestamp(entry.timestamp) }}
        </div>
        <div v-if="getChangeDescription(entry)" class="text-body-small mt-1">
          {{ getChangeDescription(entry) }}
        </div>
      </v-timeline-item>
    </v-timeline>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import type { AuditLogEntry, AuditActionType } from '../../../main/database/types'
import { useApiService } from '../composables/useApiService'

const props = defineProps<{
  entityKey: string | null
}>()

const { api } = useApiService()

const entries = ref<AuditLogEntry[]>([])
const loading = ref(false)

async function loadEntries(): Promise<void> {
  if (props.entityKey === null || props.entityKey === '') {
    entries.value = []
    return
  }

  loading.value = true
  try {
    entries.value = await api!.audit.getByEntity(props.entityKey)
  } catch (error) {
    // eslint-disable-next-line no-undef
    console.error('Failed to load audit entries:', error)
    entries.value = []
  } finally {
    loading.value = false
  }
}

function getActionColor(action: AuditActionType): string {
  switch (action) {
    case 'acmg_classify':
    case 'acmg_evidence_update':
      return 'primary'
    case 'star':
      return 'warning'
    case 'unstar':
      return 'grey'
    case 'comment_add':
    case 'comment_edit':
      return 'info'
    case 'comment_delete':
      return 'error'
    case 'tag_assign':
      return 'success'
    case 'tag_remove':
      return 'grey'
    default:
      return 'grey'
  }
}

function formatAction(action: AuditActionType): string {
  const labels: Record<AuditActionType, string> = {
    acmg_classify: 'ACMG Classification changed',
    acmg_evidence_update: 'ACMG Evidence updated',
    star: 'Starred',
    unstar: 'Unstarred',
    comment_add: 'Comment added',
    comment_edit: 'Comment edited',
    comment_delete: 'Comment deleted',
    tag_assign: 'Tag assigned',
    tag_remove: 'Tag removed'
  }
  return labels[action] ?? action
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString()
}

function getChangeDescription(entry: AuditLogEntry): string | null {
  if (entry.action_type === 'acmg_classify') {
    try {
      const oldVal = entry.old_value !== null ? JSON.parse(entry.old_value) : null
      const newVal = entry.new_value !== null ? JSON.parse(entry.new_value) : null
      const from = oldVal?.acmg_classification ?? 'none'
      const to = newVal?.acmg_classification ?? 'none'
      return `${from} \u2192 ${to}`
    } catch {
      return null
    }
  }
  return null
}

watch(() => props.entityKey, loadEntries, { immediate: true })
</script>
