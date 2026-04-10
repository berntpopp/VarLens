<template>
  <div class="vcf-file-list">
    <div v-for="file in files" :key="file.filePath" class="vcf-file-row pa-3 mb-2 rounded">
      <div class="d-flex align-center ga-3">
        <!-- Status icon -->
        <v-icon
          :icon="isLarge(file) ? mdiAlertCircleOutline : mdiCheckCircle"
          :color="isLarge(file) ? 'warning' : 'success'"
          size="22"
        />

        <!-- File name & path -->
        <div class="flex-grow-1 min-width-0">
          <div class="text-body-2 font-weight-medium text-truncate" :title="file.filePath">
            {{ fileName(file.filePath) }}
          </div>
          <div
            class="text-caption text-medium-emphasis text-truncate"
            :title="directoryName(file.filePath)"
          >
            {{ directoryName(file.filePath) }}
          </div>
        </div>

        <!-- Variant type (editable via v-select) -->
        <v-select
          :model-value="getVariantType(file)"
          :items="variantTypeOptions"
          density="compact"
          variant="outlined"
          hide-details
          class="vtype-select"
          style="max-width: 130px"
          @update:model-value="(val: unknown) => onVariantTypeChange(file.filePath, val)"
        >
          <template #selection="{ item }">
            <v-chip
              :color="variantTypeColor(item.value as string)"
              size="x-small"
              variant="tonal"
              label
            >
              {{ item.title }}
            </v-chip>
          </template>
        </v-select>

        <!-- Caller chip -->
        <v-chip
          v-if="file.callerName !== null"
          size="small"
          variant="tonal"
          label
          :prepend-icon="mdiDna"
        >
          {{ file.callerName
          }}<span v-if="file.callerVersion !== null" class="ml-1 text-medium-emphasis">
            v{{ file.callerVersion }}
          </span>
        </v-chip>
        <v-chip v-else size="small" variant="tonal" label color="grey"> Unknown caller </v-chip>

        <!-- Genome build -->
        <v-chip
          v-if="file.detectedGenomeBuild !== null && file.detectedGenomeBuild !== ''"
          size="small"
          variant="tonal"
          label
          color="info"
        >
          {{ file.detectedGenomeBuild }}
        </v-chip>

        <!-- Annotation -->
        <v-chip
          v-if="file.annotationType !== 'none'"
          size="small"
          variant="tonal"
          label
          color="success"
        >
          {{ file.annotationType === 'csq' ? 'VEP' : 'SnpEff' }}
        </v-chip>

        <!-- Variant count estimate -->
        <div
          class="text-caption text-no-wrap"
          :class="isLarge(file) ? 'text-warning' : 'text-medium-emphasis'"
        >
          <span class="font-weight-medium"> ~{{ formatCount(file.variantCountEstimate) }} </span>
          variants
        </div>
      </div>

      <!-- Warning line for large files -->
      <div v-if="isLarge(file)" class="text-caption text-warning mt-2 d-flex align-center ga-1">
        <v-icon :icon="mdiAlertOutline" size="14" />
        Large file — consider applying a BED region filter below for faster imports.
      </div>

      <!-- Samples (if multi-sample VCF) -->
      <div
        v-if="file.samples.length > 1"
        class="text-caption text-medium-emphasis mt-1 d-flex align-center ga-1"
      >
        <v-icon :icon="mdiAccountMultipleOutline" size="14" />
        {{ file.samples.length }} samples: {{ file.samples.slice(0, 3).join(', ')
        }}{{ file.samples.length > 3 ? `, +${file.samples.length - 3} more` : '' }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { VcfPreviewResult } from '../../../../shared/types/import'
import {
  mdiAccountMultipleOutline,
  mdiAlertCircleOutline,
  mdiAlertOutline,
  mdiCheckCircle,
  mdiDna
} from '@mdi/js'

export type VariantTypeOverride = { variantType?: string }

const props = defineProps<{
  files: VcfPreviewResult[]
  overrides: Map<string, VariantTypeOverride>
}>()

const emit = defineEmits<{
  'update:override': [filePath: string, override: VariantTypeOverride]
}>()

/** Threshold above which we warn about large files. */
const LARGE_FILE_THRESHOLD = 100_000

const variantTypeOptions = [
  { title: 'SNV', value: 'snv' },
  { title: 'Indel', value: 'indel' },
  { title: 'SV', value: 'sv' },
  { title: 'CNV', value: 'cnv' },
  { title: 'STR', value: 'str' }
]

function getVariantType(file: VcfPreviewResult): string {
  const override = props.overrides.get(file.filePath)
  if (override?.variantType !== undefined) return override.variantType
  return file.defaultVariantType
}

function onVariantTypeChange(filePath: string, value: unknown): void {
  emit('update:override', filePath, { variantType: String(value) })
}

function fileName(filePath: string): string {
  // Handle both Windows (\) and POSIX (/) separators
  const normalized = filePath.replace(/\\/g, '/')
  const idx = normalized.lastIndexOf('/')
  return idx === -1 ? normalized : normalized.slice(idx + 1)
}

function directoryName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const idx = normalized.lastIndexOf('/')
  return idx === -1 ? '' : normalized.slice(0, idx)
}

function formatCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(0)}K`
  return count.toLocaleString()
}

function isLarge(file: VcfPreviewResult): boolean {
  return file.variantCountEstimate > LARGE_FILE_THRESHOLD
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
</script>

<style scoped>
.vcf-file-list {
  max-height: 360px;
  overflow-y: auto;
}

.vcf-file-row {
  background-color: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  transition: border-color 0.15s ease;
}

.vcf-file-row:hover {
  border-color: rgba(var(--v-theme-primary), 0.4);
}

.min-width-0 {
  min-width: 0;
}

.vtype-select :deep(.v-field) {
  --v-field-padding-top: 4px;
  --v-field-padding-bottom: 4px;
}
</style>
