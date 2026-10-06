<template>
  <div class="activity-log-panel">
    <div class="text-title-small mb-2">Activity Log</div>

    <div v-if="restricted" class="text-body-2 text-muted py-2">
      Activity log entries are restricted to administrators.
    </div>

    <div v-else-if="loading" class="d-flex justify-center py-4">
      <v-progress-circular indeterminate size="24" />
    </div>

    <div v-else-if="entries.length === 0" class="text-body-2 text-muted py-2">
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
          <span v-if="entry.user_name" class="text-muted ml-1">by {{ entry.user_name }}</span>
        </div>
        <div class="text-body-small text-muted">
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
import { computed, ref, watch } from 'vue'
import type { AuditLogEntry, AuditActionType } from '../../../shared/types/database-entities'
import { useApiService } from '../composables/useApiService'
import { useAuthStore } from '../stores/authStore'
import { logService } from '../services/LogService'
import { isIpcError, unwrapIpcResult } from '../../../shared/types/errors'

const props = defineProps<{
  entityKey: string | null
}>()

const { api } = useApiService()
const authStore = useAuthStore()

// Audit reads are admin-only when accounts are enforced (web mode);
// the server 403s them, so don't fetch and don't log an error loop.
// Desktop (accounts disabled) is unaffected.
const restricted = computed(() => authStore.accountsEnabled && !authStore.isAdmin)

const entries = ref<AuditLogEntry[]>([])
const loading = ref(false)

async function loadEntries(): Promise<void> {
  if (restricted.value || props.entityKey === null || props.entityKey === '') {
    entries.value = []
    return
  }

  loading.value = true
  try {
    entries.value = unwrapIpcResult(await api!.audit.getByEntity(props.entityKey))
  } catch (error) {
    logService.error(
      'Failed to load audit entries: ' +
        (error instanceof Error
          ? error.message
          : isIpcError(error)
            ? (error.userMessage ?? error.message)
            : String(error)),
      'audit'
    )
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
    tag_remove: 'Tag removed',
    auth_login_success: 'Login succeeded',
    auth_login_failure: 'Login failed',
    auth_logout: 'Logout',
    auth_password_change: 'Password changed',
    auth_password_reset: 'Password reset',
    auth_user_deactivate: 'User deactivated',
    api_read: 'API read',
    api_write: 'API write'
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

watch([() => props.entityKey, restricted], loadEntries, { immediate: true })
</script>
