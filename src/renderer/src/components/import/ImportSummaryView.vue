<template>
  <div>
    <!-- Success banner -->
    <v-alert
      :icon="hasErrors ? mdiAlertCircleOutline : mdiCheckCircle"
      :color="hasErrors ? 'warning' : 'success'"
      variant="tonal"
      density="comfortable"
      class="mb-4"
    >
      <div class="d-flex align-center">
        <div class="flex-grow-1">
          <div class="text-subtitle-1 font-weight-medium">Case imported: {{ caseName }}</div>
          <div class="text-body-2">
            {{ result.totalVariants.toLocaleString() }} variants across
            {{ result.files.length }} file{{ result.files.length === 1 ? '' : 's' }}
            <span v-if="result.elapsed > 0"> in {{ formatElapsed(result.elapsed) }} </span>
          </div>
        </div>
      </div>
    </v-alert>

    <!-- Variant type breakdown -->
    <div class="text-caption text-medium-emphasis mb-2">VARIANT TYPE BREAKDOWN</div>
    <v-card variant="outlined" class="mb-4">
      <v-list density="compact">
        <v-list-item v-for="(entry, idx) in typeBreakdown" :key="entry.type">
          <template #prepend>
            <v-chip
              :color="variantTypeColor(entry.type)"
              size="small"
              variant="tonal"
              label
              class="mr-2"
              style="min-width: 60px; justify-content: center"
            >
              {{ entry.type.toUpperCase() }}
            </v-chip>
          </template>
          <v-list-item-title class="text-body-2">
            {{ entry.count.toLocaleString() }} variants
          </v-list-item-title>
          <v-list-item-subtitle class="text-caption">
            {{ entry.files.length }} file{{ entry.files.length === 1 ? '' : 's' }}
          </v-list-item-subtitle>
          <template #append>
            <div class="text-caption text-medium-emphasis">{{ percentage(entry.count) }}%</div>
          </template>
          <v-divider v-if="idx < typeBreakdown.length - 1" />
        </v-list-item>
      </v-list>
    </v-card>

    <!-- File results (collapsible) -->
    <v-expansion-panels variant="accordion" class="mb-4">
      <v-expansion-panel>
        <v-expansion-panel-title class="text-body-2">
          File details ({{ result.files.length }})
        </v-expansion-panel-title>
        <v-expansion-panel-text>
          <v-table density="compact">
            <thead>
              <tr>
                <th class="text-left">File</th>
                <th class="text-left">Type</th>
                <th class="text-left">Caller</th>
                <th class="text-right">Variants</th>
                <th class="text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="file in result.files" :key="file.filePath">
                <td
                  class="text-body-2 text-truncate"
                  :title="file.filePath"
                  style="max-width: 260px"
                >
                  {{ fileName(file.filePath) }}
                </td>
                <td>
                  <v-chip
                    :color="variantTypeColor(file.variantType)"
                    size="x-small"
                    variant="tonal"
                    label
                  >
                    {{ file.variantType.toUpperCase() }}
                  </v-chip>
                </td>
                <td class="text-body-2">{{ callerOf(file.filePath) }}</td>
                <td class="text-right text-body-2">{{ file.variantCount.toLocaleString() }}</td>
                <td>
                  <v-icon
                    v-if="file.error === undefined"
                    :icon="mdiCheckCircle"
                    color="success"
                    size="16"
                  />
                  <v-tooltip v-else location="top">
                    <template #activator="{ props: tooltipProps }">
                      <v-icon
                        v-bind="tooltipProps"
                        :icon="mdiAlertCircle"
                        color="error"
                        size="16"
                      />
                    </template>
                    {{ file.error }}
                  </v-tooltip>
                </td>
              </tr>
            </tbody>
          </v-table>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>

    <!-- Metadata chips -->
    <div class="d-flex flex-wrap ga-2 mb-4">
      <v-chip
        v-if="detectedBuild !== null"
        size="small"
        variant="tonal"
        label
        color="info"
        :prepend-icon="mdiDna"
      >
        {{ detectedBuild }}
      </v-chip>
      <v-chip v-for="caller in distinctCallers" :key="caller" size="small" variant="tonal" label>
        {{ caller }}
      </v-chip>
      <v-chip
        v-for="ann in distinctAnnotations"
        :key="ann"
        size="small"
        variant="tonal"
        label
        color="success"
      >
        {{ ann }}
      </v-chip>
      <v-chip v-if="result.totalSkipped > 0" size="small" variant="tonal" label color="warning">
        {{ result.totalSkipped.toLocaleString() }} skipped
      </v-chip>
    </div>

    <!-- Action buttons -->
    <div class="d-flex ga-2 justify-end">
      <v-btn variant="text" @click="emit('close')">Close</v-btn>
      <v-btn variant="outlined" :prepend-icon="mdiPlusCircleOutline" @click="emit('import-more')">
        Import more
      </v-btn>
      <v-btn
        color="primary"
        variant="flat"
        :prepend-icon="mdiEyeOutline"
        @click="emit('view-case')"
      >
        View case
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { MultiFileImportResult } from '../../../../shared/types/api'
import type { VcfPreviewResult } from '../../../../shared/types/import'
import {
  mdiAlertCircle,
  mdiAlertCircleOutline,
  mdiCheckCircle,
  mdiDna,
  mdiEyeOutline,
  mdiPlusCircleOutline
} from '@mdi/js'

const props = defineProps<{
  result: MultiFileImportResult
  caseName: string
  fileResults: VcfPreviewResult[]
}>()

const emit = defineEmits<{
  'view-case': []
  'import-more': []
  close: []
}>()

const hasErrors = computed(() => props.result.files.some((f) => f.error !== undefined))

const typeBreakdown = computed(() => {
  const map = new Map<string, { type: string; count: number; files: string[] }>()
  for (const file of props.result.files) {
    if (file.error !== undefined) continue
    const existing = map.get(file.variantType)
    if (existing !== undefined) {
      existing.count += file.variantCount
      existing.files.push(file.filePath)
    } else {
      map.set(file.variantType, {
        type: file.variantType,
        count: file.variantCount,
        files: [file.filePath]
      })
    }
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count)
})

const detectedBuild = computed(() => {
  for (const file of props.fileResults) {
    if (file.detectedGenomeBuild !== null && file.detectedGenomeBuild !== '') {
      return file.detectedGenomeBuild
    }
  }
  return null
})

const distinctCallers = computed(() => {
  const set = new Set<string>()
  for (const file of props.fileResults) {
    if (file.callerName !== null) {
      set.add(
        file.callerVersion !== null ? `${file.callerName} v${file.callerVersion}` : file.callerName
      )
    }
  }
  return Array.from(set)
})

const distinctAnnotations = computed(() => {
  const set = new Set<string>()
  for (const file of props.fileResults) {
    if (file.annotationType === 'csq') set.add('VEP (CSQ)')
    else if (file.annotationType === 'ann') set.add('SnpEff (ANN)')
  }
  return Array.from(set)
})

function percentage(count: number): string {
  if (props.result.totalVariants === 0) return '0'
  return ((count / props.result.totalVariants) * 100).toFixed(1)
}

function variantTypeColor(type: string): string {
  switch (type) {
    case 'snv':
      return 'primary'
    case 'indel':
      return 'deep-purple'
    case 'sv':
      return 'orange'
    case 'cnv':
      return 'teal'
    case 'str':
      return 'pink'
    default:
      return 'grey'
  }
}

function fileName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const idx = normalized.lastIndexOf('/')
  return idx === -1 ? normalized : normalized.slice(idx + 1)
}

function callerOf(filePath: string): string {
  const preview = props.fileResults.find((f) => f.filePath === filePath)
  if (preview === undefined || preview.callerName === null) return '—'
  return preview.callerName
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  const rem = Math.round(seconds - minutes * 60)
  return `${minutes}m ${rem}s`
}
</script>
