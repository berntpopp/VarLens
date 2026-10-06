<script setup lang="ts">
/**
 * Admin settings for external reference lookups (web server egress policy).
 *
 * Each service sends identifiers from this server to a third party (what is
 * sent and where is listed per row). Every service is off until an
 * administrator turns it on here; the setting is stored on the server and
 * applies to all users. Every lookup is recorded in the audit log.
 */
import { computed, onMounted, ref } from 'vue'

import { useApiService } from '../../composables/useApiService'
import { useCapabilityStore } from '../../stores/capabilityStore'
import { formatErrorMessage } from '../../../../shared/errors/format-error-message'
import { unwrapIpcResult } from '../../../../shared/types/errors'
import type {
  ReferenceServiceId,
  ReferenceServicesStatus
} from '../../../../shared/ipc/domains/reference-services'

const { api } = useApiService()
const capabilities = useCapabilityStore()
const status = ref<ReferenceServicesStatus | null>(null)
const loadFailed = ref(false)
const saving = ref<ReferenceServiceId | null>(null)
const error = ref<string | null>(null)

const services = computed(() => status.value?.services ?? [])
const lastChange = computed(() => {
  const current = status.value
  if (current === null || current.updatedAt === null) return 'Never changed: all lookups are off.'
  const when = new Date(current.updatedAt).toLocaleString()
  return `Last changed ${when}${current.updatedBy !== null ? ` by ${current.updatedBy}` : ''}.`
})

async function load(): Promise<void> {
  if (!api) return
  try {
    status.value = unwrapIpcResult(await api.referenceServices.status())
    loadFailed.value = false
  } catch {
    loadFailed.value = true
  }
}

async function toggle(id: ReferenceServiceId, enabled: boolean): Promise<void> {
  if (!api) return
  saving.value = id
  error.value = null
  try {
    status.value = unwrapIpcResult(await api.referenceServices.setPolicy({ [id]: enabled }))
    // The capability document carries the lookups as instance features:
    // refresh it so this session's UI follows the new policy at once.
    await capabilities.load()
  } catch (e) {
    error.value = formatErrorMessage(e, 'Saving the setting failed.')
  } finally {
    saving.value = null
  }
}

onMounted(() => void load())
</script>

<template>
  <v-card flat data-testid="external-lookups-settings">
    <v-card-title>External lookups</v-card-title>
    <v-card-text>
      <p class="text-body-medium mb-2">
        These services send identifiers from this server to third-party websites. They are off by
        default. Turning one on applies to every user, and every lookup is recorded in the audit log
        with the user and what was sent.
      </p>
      <p class="text-body-small text-medium-emphasis mb-4">{{ lastChange }}</p>

      <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-3">
        {{ error }}
      </v-alert>
      <v-alert
        v-if="loadFailed && status === null"
        type="warning"
        variant="tonal"
        density="compact"
        class="mb-3"
      >
        The current settings could not be loaded.
      </v-alert>

      <v-list density="compact" class="py-0">
        <v-list-item
          v-for="service in services"
          :key="service.id"
          class="px-0 external-lookup-row"
          :data-testid="`external-lookup-${service.id}`"
        >
          <v-list-item-title class="font-weight-medium">{{ service.label }}</v-list-item-title>
          <v-list-item-subtitle class="external-lookup-detail">
            Sends: {{ service.sends }}. To: {{ service.hosts.join(', ') }}
          </v-list-item-subtitle>
          <template #append>
            <v-switch
              :model-value="service.enabled"
              :loading="saving === service.id"
              :disabled="saving !== null"
              :aria-label="`${service.label} lookups`"
              color="primary"
              density="compact"
              hide-details
              inset
              @update:model-value="toggle(service.id, $event === true)"
            />
          </template>
        </v-list-item>
      </v-list>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.external-lookup-row + .external-lookup-row {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.external-lookup-detail {
  white-space: normal;
  -webkit-line-clamp: unset;
  line-clamp: unset;
}
</style>
