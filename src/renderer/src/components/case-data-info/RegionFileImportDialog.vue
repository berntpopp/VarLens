<template>
  <v-dialog
    :model-value="modelValue"
    max-width="500"
    persistent
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <span>Import BED Region File</span>
        <v-spacer />
        <v-btn
          :icon="mdiClose"
          variant="text"
          size="small"
          @click="$emit('update:modelValue', false)"
        />
      </v-card-title>
      <v-card-text>
        <v-text-field
          v-model="regionFileName"
          label="Region file name"
          variant="outlined"
          density="compact"
          class="mb-3"
          hide-details
        />
        <v-text-field
          v-model="regionFileDescription"
          label="Description (optional)"
          variant="outlined"
          density="compact"
          class="mb-3"
          hide-details
        />
        <v-btn
          variant="outlined"
          color="primary"
          :prepend-icon="mdiFileUploadOutline"
          :loading="importingRegion"
          @click="selectBedFile"
        >
          {{ selectedBedPath ? 'Change file...' : 'Select BED file...' }}
        </v-btn>
        <div v-if="selectedBedPath" class="text-body-2 mt-2">
          {{ selectedBedBasename }}
        </div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="$emit('update:modelValue', false)">Cancel</v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :disabled="!regionFileName.trim() || !selectedBedPath"
          :loading="importingRegion"
          @click="importRegionFile"
        >
          Import
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useApiService } from '../../composables/useApiService'
import { mdiClose, mdiFileUploadOutline } from '@mdi/js'
import { logService } from '../../services/LogService'
import { isIpcError, unwrapIpcResult } from '../../../../shared/types/errors'

interface RegionFileItem {
  id: number
  name: string
  region_count: number
  total_bases: number
}

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  imported: [payload: { regionFileId: number; regionFiles: RegionFileItem[] }]
}>()

const regionFileName = ref('')
const regionFileDescription = ref('')
const selectedBedPath = ref('')
const importingRegion = ref(false)

const selectedBedBasename = computed(() => {
  if (!selectedBedPath.value) return ''
  const parts = selectedBedPath.value.split(/[/\\]/)
  return parts[parts.length - 1]
})

const { api } = useApiService()

// Reset state when dialog opens
watch(
  () => props.modelValue,
  (visible) => {
    if (!visible) return
    regionFileName.value = ''
    regionFileDescription.value = ''
    selectedBedPath.value = ''
  }
)

async function selectBedFile(): Promise<void> {
  if (!api) return

  importingRegion.value = true
  try {
    // wrapHandler resolves an IpcResult even on failure — a raw await here
    // would only fail the `typeof result === 'string'` guard silently below,
    // leaving the user with no feedback that the dialog failed to open.
    // Unwrap so a failure throws into the catch below.
    const result = unwrapIpcResult(await api.import.selectBedFile())
    if (typeof result === 'string') {
      applySelectedBedFile(result)
    }
  } catch (e) {
    logService.warn(
      'Failed to select BED file: ' +
        (e instanceof Error ? e.message : isIpcError(e) ? (e.userMessage ?? e.message) : String(e)),
      'region-import'
    )
  } finally {
    importingRegion.value = false
  }
}

function applySelectedBedFile(path: string): void {
  selectedBedPath.value = path
  if (regionFileName.value.trim() !== '') return

  const parts = path.split(/[/\\]/)
  const displayName = parts[parts.length - 1] ?? path
  regionFileName.value = displayName.replace(/\.bed(?:\.gz)?$/i, '')
}

async function importRegionFile(): Promise<void> {
  const name = regionFileName.value.trim()
  if (name === '' || !selectedBedPath.value || !api) return
  importingRegion.value = true
  try {
    const regionFilesApi = api.regionFiles
    // wrapHandler resolves an IpcResult even on failure — a raw await here
    // would store a SerializableError as if it were the created RegionFile
    // (or the refreshed list), then feed `created.id` (undefined) into
    // importBed and emit a corrupted `imported` payload to the parent.
    const created = unwrapIpcResult(
      await regionFilesApi.create(name, regionFileDescription.value.trim() || null)
    )
    unwrapIpcResult(await regionFilesApi.importBed(created.id, selectedBedPath.value))

    const updatedFiles = unwrapIpcResult(await regionFilesApi.list())
    emit('imported', { regionFileId: created.id, regionFiles: updatedFiles })
    emit('update:modelValue', false)
  } catch (e) {
    logService.error(
      'Failed to import region file: ' +
        (e instanceof Error ? e.message : isIpcError(e) ? (e.userMessage ?? e.message) : String(e)),
      'region-import'
    )
  } finally {
    importingRegion.value = false
  }
}
</script>
