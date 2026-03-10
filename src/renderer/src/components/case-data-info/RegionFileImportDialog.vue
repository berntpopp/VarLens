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
          icon="mdi-close"
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
          prepend-icon="mdi-file-upload-outline"
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
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (api as any).import.selectFile()
    if (typeof result === 'string') {
      selectedBedPath.value = result
      if (regionFileName.value.trim() === '') {
        const parts = result.split(/[/\\]/)
        const basename = parts[parts.length - 1]
        regionFileName.value = basename.replace(/\.bed$/i, '')
      }
    }
  } catch {
    // Silently fail
  }
}

async function importRegionFile(): Promise<void> {
  const name = regionFileName.value.trim()
  if (name === '' || !selectedBedPath.value || !api) return
  importingRegion.value = true
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const regionFilesApi = (api as any).regionFiles
    const created = await regionFilesApi.create(name, regionFileDescription.value.trim() || null)
    await regionFilesApi.importBed(created.id, selectedBedPath.value)

    const updatedFiles = await regionFilesApi.list()
    emit('imported', { regionFileId: created.id, regionFiles: updatedFiles })
    emit('update:modelValue', false)
  } catch {
    // Silently fail
  } finally {
    importingRegion.value = false
  }
}
</script>
