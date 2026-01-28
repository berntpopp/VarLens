<template>
  <v-footer app color="#E5AA94" class="px-4 py-1" height="auto">
    <div class="d-flex align-center justify-space-between" style="width: 100%">
      <!-- Left section: Version menu + network status -->
      <div class="d-flex align-center">
        <v-menu>
          <template #activator="{ props }">
            <v-btn v-bind="props" variant="text" size="small" class="text-caption">
              v{{ appVersion }}
            </v-btn>
          </template>
          <v-list density="compact">
            <v-list-item>
              <v-list-item-title>VarLens v{{ appVersion }}</v-list-item-title>
              <v-list-item-subtitle>Electron v{{ electronVersion }}</v-list-item-subtitle>
            </v-list-item>
          </v-list>
        </v-menu>
        <v-tooltip
          :text="isOnline ? 'Online - API enrichment available' : 'Offline - using cached data'"
        >
          <template #activator="{ props }">
            <v-icon
              v-bind="props"
              :icon="isOnline ? 'mdi-wifi' : 'mdi-wifi-off'"
              :color="isOnline ? 'success' : 'grey'"
              size="x-small"
              class="ml-1"
              style="opacity: 0.7"
            />
          </template>
        </v-tooltip>
      </div>

      <!-- Right section: Action buttons -->
      <div class="d-flex align-center ga-1">
        <v-btn
          icon="mdi-github"
          size="small"
          variant="text"
          aria-label="Open GitHub repository"
          @click="openGitHub"
        />
        <v-btn
          icon="mdi-license"
          size="small"
          variant="text"
          aria-label="View license"
          @click="openLicense"
        />
        <v-btn
          :icon="disclaimerAcknowledged ? 'mdi-shield-check' : 'mdi-shield-alert'"
          :color="disclaimerAcknowledged ? 'success' : 'warning'"
          size="small"
          variant="text"
          aria-label="View disclaimer"
          @click="openDisclaimer"
        />
        <v-btn
          icon="mdi-help-circle"
          size="small"
          variant="text"
          aria-label="Open FAQ"
          @click="openFAQ"
        />
        <v-btn
          icon
          size="small"
          variant="text"
          aria-label="Toggle log viewer"
          @click="toggleLogViewer"
        >
          <v-badge :content="errorCount" :model-value="errorCount > 0" color="error" floating>
            <v-icon>mdi-console</v-icon>
          </v-badge>
        </v-btn>
      </div>
    </div>
  </v-footer>
</template>

<script setup lang="ts">
/* global window, console, navigator */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useLogStore } from '../stores/logStore'

defineProps<{
  disclaimerAcknowledged: boolean
}>()

const emit = defineEmits<{
  'toggle-log-viewer': []
  'open-disclaimer': []
  'open-faq': []
}>()

// Version state
const appVersion = ref('...')
const electronVersion = ref('')

// Network status
const isOnline = ref(navigator.onLine)

const handleOnline = (): void => {
  isOnline.value = true
}

const handleOffline = (): void => {
  isOnline.value = false
}

// Log store integration
const logStore = useLogStore()
const { stats } = storeToRefs(logStore)
const errorCount = computed(() => stats.value.errorCount + stats.value.criticalCount)

// Lifecycle: fetch version info and set up network listeners
onMounted(async () => {
  // Network status listeners
  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)

  if (typeof window.api !== 'undefined') {
    try {
      const versionInfo = await window.api.system.getVersion()
      appVersion.value = versionInfo.app
      electronVersion.value = versionInfo.electron
    } catch (error) {
      console.error('Failed to fetch version info:', error)
    }
  }
})

onUnmounted(() => {
  window.removeEventListener('online', handleOnline)
  window.removeEventListener('offline', handleOffline)
})

// Handlers
const toggleLogViewer = (): void => {
  emit('toggle-log-viewer')
}

const openDisclaimer = (): void => {
  emit('open-disclaimer')
}

const openFAQ = (): void => {
  emit('open-faq')
}

const openGitHub = async (): Promise<void> => {
  if (typeof window.api !== 'undefined') {
    try {
      const result = await window.api.shell.openExternal('https://github.com/berntpopp/varlens')
      if (!result.success) {
        console.error('Failed to open GitHub URL:', result.error)
      }
    } catch (error) {
      console.error('Failed to open GitHub URL:', error)
    }
  }
}

const openLicense = async (): Promise<void> => {
  if (typeof window.api !== 'undefined') {
    try {
      const result = await window.api.shell.openExternal('https://opensource.org/licenses/MIT')
      if (!result.success) {
        console.error('Failed to open license URL:', result.error)
      }
    } catch (error) {
      console.error('Failed to open license URL:', error)
    }
  }
}
</script>
