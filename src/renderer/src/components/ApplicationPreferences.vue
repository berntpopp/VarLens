<template>
  <v-dialog v-model="isOpen" max-width="500" scrollable>
    <v-card>
      <v-card-title>Application Preferences</v-card-title>
      <v-card-text>
        <!-- Display name -->
        <v-text-field
          v-model="settings.userName"
          label="Display Name"
          hint="Used for audit trail"
          persistent-hint
          class="mb-4"
        />

        <!-- Items per page -->
        <v-select
          v-model="settings.itemsPerPage"
          :items="[10, 25, 50, 100]"
          label="Items Per Page"
          class="mb-4"
        />

        <!-- Worker threads -->
        <v-slider
          v-model="workerThreadsValue"
          :min="0"
          :max="cpuCount"
          :step="1"
          label="Worker Threads"
          thumb-label
        >
          <template #thumb-label="{ modelValue }">
            {{ modelValue === 0 ? 'Auto' : modelValue }}
          </template>
        </v-slider>
        <div class="text-caption text-grey mb-4">
          {{
            workerThreadsValue === 0
              ? `Auto: ${cpuCount - 1} threads`
              : `${workerThreadsValue} threads`
          }}
          &middot; Takes effect on next database open
        </div>

        <!-- Pre-fetch -->
        <v-switch
          v-model="settings.prefetchEnabled"
          label="Pre-fetch next page"
          color="primary"
          hide-details
        />
      </v-card-text>

      <v-divider />

      <v-card-actions>
        <v-spacer />
        <v-btn color="primary" variant="flat" @click="isOpen = false">Close</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useSettingsStore } from '../stores/settingsStore'
import { useApiService } from '../composables/useApiService'

const settings = useSettingsStore()
const { api } = useApiService()

const isOpen = ref(false)
const cpuCount = ref(
  // eslint-disable-next-line no-undef
  navigator.hardwareConcurrency || 4
)

// Get CPU count from main process via typed API
onMounted(async () => {
  try {
    if (api?.system?.getCpuCount) {
      cpuCount.value = await api.system.getCpuCount()
    }
  } catch {
    // fallback to navigator.hardwareConcurrency
  }
})

const workerThreadsValue = computed({
  get: () => settings.workerThreads,
  set: (val: number) => {
    settings.workerThreads = val
    // Sync to main process DbPool — takes effect on next database open
    api?.system?.setWorkerThreads(val)
  }
})

const show = (): void => {
  isOpen.value = true
}

defineExpose({ show })
</script>
