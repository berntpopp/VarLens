<template>
  <div class="d-flex align-center justify-space-between px-3 py-2 bg-grey-lighten-4">
    <span class="text-caption text-medium-emphasis">
      HPO data:
      {{ status?.installed === true ? status.version : 'not installed' }}
      <template v-if="status?.needsUpdate === true">&middot; needs update</template>
      <template v-if="message !== ''">&middot; {{ message }}</template>
      <span v-if="sources !== ''" class="d-block" data-testid="hpo-data-sources">{{
        sources
      }}</span>
    </span>
    <v-btn
      v-if="canUpdate"
      size="x-small"
      variant="text"
      color="primary"
      :loading="updating"
      @click="update"
    >
      {{ status?.installed === true ? 'Update' : 'Download' }}
    </v-btn>
  </div>
</template>

<script setup lang="ts">
// HPO release behind the shortlist's hpo_resnik field (#600); desktop updates it.
import { computed, onMounted, ref } from 'vue'
import { useApiService } from '../../composables/useApiService'
import { useCapabilityStore } from '../../stores/capabilityStore'
import { logService } from '../../services/LogService'
import { formatError } from '../../utils/ipc-result'
import { notifyPhenotypeChanged } from '../../composables/phenotypeChanges'
import { unwrapIpcResult } from '../../../../shared/types/errors'
import type { HpoDataStatus } from '../../../../shared/types/hpo-data'
import { HPO_DATA_SOURCE_ATTRIBUTION } from '../../config/uiCopyConfig'

const { api } = useApiService()
const capabilities = useCapabilityStore()
const canUpdate = computed(() => capabilities.canUse('hpoDataUpdate'))
const status = ref<HpoDataStatus | null>(null)
const updating = ref(false)
const message = ref('')
// One line: each source with its attribution and installed version.
const sources = computed(() =>
  Object.entries(status.value?.sources ?? {})
    .map(([key, version]) => `${HPO_DATA_SOURCE_ATTRIBUTION[key] ?? key} ${version}`)
    .join(' · ')
)

onMounted(async () => {
  try {
    status.value = api ? unwrapIpcResult(await api.hpoData.status()) : null
  } catch (e) {
    logService.warn(`Failed to load HPO data status: ${formatError(e)}`, 'hpo-data')
  }
})

async function update(): Promise<void> {
  if (!api || !canUpdate.value) return
  updating.value = true
  message.value = ''
  try {
    const result = unwrapIpcResult(await api.hpoData.update())
    status.value = result.status
    message.value = result.message
    if (result.success) notifyPhenotypeChanged(null)
  } catch (e) {
    message.value = formatError(e)
  } finally {
    updating.value = false
  }
}
</script>
