<script setup lang="ts">
/** Import wizard, JSON exports: the annotation fields of the first file and where they go. */
import { onMounted, ref } from 'vue'
import type { ImportFieldProfile } from '../../../../shared/config/import-fields.config'
import type { JsonFieldPreviewResult } from '../../../../shared/types/import'
import { formatErrorMessage } from '../../../../shared/errors/format-error-message'
import { unwrapIpcResult } from '../../../../shared/types/errors'
import { useApiService } from '../../composables/useApiService'
import { usePermissions } from '../../composables/usePermissions'
import { logService } from '../../services/LogService'
import ImportFieldProfileTable from './ImportFieldProfileTable.vue'

const props = defineProps<{ filePath: string; fileCount: number }>()
const profile = defineModel<ImportFieldProfile>({ required: true })

const { api } = useApiService()
const { canWrite } = usePermissions()
const loading = ref(true)
const error = ref<string | null>(null)
const preview = ref<JsonFieldPreviewResult | null>(null)

onMounted(async () => {
  try {
    preview.value = unwrapIpcResult(await api!.import.jsonPreview(props.filePath))
  } catch (err) {
    error.value = formatErrorMessage(err, 'Could not read the fields of this file')
    logService.warn(`JSON field preview failed: ${error.value}`, 'JsonFieldProfileStep')
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <v-expansion-panels variant="accordion" class="mt-3">
    <v-expansion-panel>
      <v-expansion-panel-title class="text-body-2">
        Annotation fields
        <span v-if="preview" class="text-medium-emphasis ml-1">
          ({{ preview.fields.length }}, from the first {{ preview.variantsScanned }} variants{{
            fileCount > 1 ? ' of the first file; applies to every file' : ''
          }})
        </span>
      </v-expansion-panel-title>
      <v-expansion-panel-text>
        <div v-if="loading" class="d-flex align-center ga-2 pa-2 text-body-2">
          <v-progress-circular indeterminate size="18" width="2" color="primary" />
          Reading fields…
        </div>
        <v-alert v-else-if="error" type="warning" variant="tonal" density="compact">
          {{ error }} The import keeps fields as set in Settings → Import fields.
        </v-alert>
        <ImportFieldProfileTable
          v-else-if="preview"
          v-model="profile"
          :fields="preview.fields"
          :readonly="!canWrite"
          can-save-default
        />
      </v-expansion-panel-text>
    </v-expansion-panel>
  </v-expansion-panels>
</template>
