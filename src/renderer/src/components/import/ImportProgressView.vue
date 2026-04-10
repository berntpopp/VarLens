<template>
  <div>
    <!-- Overall progress -->
    <div class="d-flex align-center mb-2">
      <div class="text-body-2 font-weight-medium flex-grow-1">
        {{ overallLabel }}
      </div>
      <div class="text-caption text-medium-emphasis">{{ overallPercent }}%</div>
    </div>
    <v-progress-linear
      :model-value="overallPercent"
      color="primary"
      height="10"
      rounded
      class="mb-4"
    />

    <!-- Per-file list -->
    <div class="file-progress-list">
      <div
        v-for="file in files"
        :key="file.filePath"
        class="file-progress-row pa-2 mb-1 rounded d-flex align-center ga-3"
        :class="rowClass(file.filePath)"
      >
        <!-- Status icon / spinner -->
        <div class="status-icon d-flex align-center justify-center">
          <v-progress-circular
            v-if="statusOf(file.filePath) === 'importing'"
            indeterminate
            size="18"
            width="2"
            color="primary"
          />
          <v-icon
            v-else-if="statusOf(file.filePath) === 'done'"
            :icon="mdiCheckCircle"
            color="success"
            size="20"
          />
          <v-icon
            v-else-if="statusOf(file.filePath) === 'error'"
            :icon="mdiAlertCircle"
            color="error"
            size="20"
          />
          <v-icon v-else :icon="mdiCircleOutline" color="grey" size="20" />
        </div>

        <!-- File name -->
        <div class="flex-grow-1 min-width-0">
          <div class="text-body-2 text-truncate" :title="file.filePath">
            {{ fileName(file.filePath) }}
          </div>
          <div
            v-if="statusOf(file.filePath) === 'error'"
            class="text-caption text-error text-truncate"
            :title="statuses.get(file.filePath)?.error"
          >
            {{ statuses.get(file.filePath)?.error }}
          </div>
          <div
            v-else-if="statusOf(file.filePath) === 'done'"
            class="text-caption text-medium-emphasis"
          >
            {{ (statuses.get(file.filePath)?.variantCount ?? 0).toLocaleString() }} variants
            imported
          </div>
          <div
            v-else-if="statusOf(file.filePath) === 'importing'"
            class="text-caption text-primary"
          >
            {{ importingLabel(file.filePath) }}
          </div>
          <div v-else class="text-caption text-medium-emphasis">Waiting…</div>
        </div>

        <!-- Variant type chip -->
        <v-chip size="x-small" variant="tonal" label>
          {{ (file.defaultVariantType ?? 'snv').toUpperCase() }}
        </v-chip>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { VcfPreviewResult } from '../../../../shared/types/import'
import { mdiAlertCircle, mdiCheckCircle, mdiCircleOutline } from '@mdi/js'

export type FileImportStatus = 'pending' | 'importing' | 'done' | 'error'

export interface FileStatusEntry {
  status: FileImportStatus
  variantCount?: number
  error?: string
  /** Current variant count being processed (for live updates while importing). */
  liveCount?: number
  /** Current import phase (reading, parsing, inserting). */
  phase?: string
}

const props = defineProps<{
  files: VcfPreviewResult[]
  statuses: Map<string, FileStatusEntry>
  currentFile: string | null
  overallPercent: number
}>()

const overallLabel = computed(() => {
  const total = props.files.length
  const done = Array.from(props.statuses.values()).filter(
    (s) => s.status === 'done' || s.status === 'error'
  ).length
  const current = props.currentFile
  if (current !== null && done < total) {
    return `Importing file ${done + 1} of ${total}`
  }
  if (done === total) return `Imported ${total} file(s)`
  return `Starting import of ${total} file(s)`
})

function statusOf(filePath: string): FileImportStatus {
  return props.statuses.get(filePath)?.status ?? 'pending'
}

function importingLabel(filePath: string): string {
  const entry = props.statuses.get(filePath)
  if (entry === undefined) return 'Processing…'
  const phase = entry.phase ?? 'processing'
  const count = entry.liveCount ?? 0
  if (count > 0) return `${phase}… ${count.toLocaleString()} variants`
  return `${phase}…`
}

function rowClass(filePath: string): string {
  const status = statusOf(filePath)
  if (status === 'importing') return 'file-progress-row--active'
  if (status === 'done') return 'file-progress-row--done'
  if (status === 'error') return 'file-progress-row--error'
  return ''
}

function fileName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const idx = normalized.lastIndexOf('/')
  return idx === -1 ? normalized : normalized.slice(idx + 1)
}
</script>

<style scoped>
.file-progress-list {
  max-height: 320px;
  overflow-y: auto;
}

.file-progress-row {
  background-color: rgb(var(--v-theme-background));
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease;
}

.file-progress-row--active {
  border-color: rgb(var(--v-theme-primary));
  background-color: rgba(var(--v-theme-primary), 0.05);
}

.file-progress-row--done {
  border-color: rgba(var(--v-theme-success), 0.4);
}

.file-progress-row--error {
  border-color: rgba(var(--v-theme-error), 0.4);
  background-color: rgba(var(--v-theme-error), 0.03);
}

.status-icon {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
}

.min-width-0 {
  min-width: 0;
}
</style>
