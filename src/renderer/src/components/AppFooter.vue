<template>
  <v-footer app color="#E5AA94" class="px-4 py-1" height="auto">
    <div class="d-flex align-center justify-space-between" style="width: 100%">
      <!-- Left section: Version menu + network status -->
      <div class="d-flex align-center">
        <v-menu>
          <template #activator="{ props }">
            <v-btn v-bind="props" variant="text" size="small" class="text-body-small">
              VarLens v{{ appVersion }}
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

        <!-- Update indicator -->
        <template v-if="updateStatus.state === 'checking'">
          <v-tooltip text="Checking for updates...">
            <template #activator="{ props: tooltipProps }">
              <v-btn
                v-bind="tooltipProps"
                icon
                size="x-small"
                variant="text"
                class="ml-1"
                :loading="true"
              >
                <v-icon size="x-small">mdi-refresh</v-icon>
              </v-btn>
            </template>
          </v-tooltip>
        </template>

        <template v-else-if="updateStatus.state === 'available'">
          <v-tooltip
            :text="`Update${updateStatus.version ? ` v${updateStatus.version}` : ''} available — click to download`"
          >
            <template #activator="{ props: tooltipProps }">
              <v-btn
                v-bind="tooltipProps"
                icon
                size="x-small"
                variant="text"
                color="info"
                class="ml-1"
                @click="downloadUpdate"
              >
                <v-icon size="x-small">mdi-arrow-up-circle</v-icon>
              </v-btn>
            </template>
          </v-tooltip>
        </template>

        <template v-else-if="updateStatus.state === 'downloading'">
          <v-tooltip
            :text="`Downloading update... ${Math.round(updateStatus.progress?.percent ?? 0)}%`"
          >
            <template #activator="{ props: tooltipProps }">
              <v-btn
                v-bind="tooltipProps"
                icon
                size="x-small"
                variant="text"
                class="ml-1"
                :loading="true"
              >
                <v-icon size="x-small">mdi-download</v-icon>
              </v-btn>
            </template>
          </v-tooltip>
        </template>

        <template v-else-if="updateStatus.state === 'downloaded'">
          <v-tooltip text="Update ready — click to restart">
            <template #activator="{ props: tooltipProps }">
              <v-btn
                v-bind="tooltipProps"
                icon
                size="x-small"
                variant="text"
                color="primary"
                class="ml-1"
                @click="installUpdate"
              >
                <v-badge dot color="success" floating>
                  <v-icon size="x-small">mdi-restart</v-icon>
                </v-badge>
              </v-btn>
            </template>
          </v-tooltip>
        </template>

        <template v-else-if="updateStatus.state === 'error'">
          <v-tooltip :text="`Update error: ${updateStatus.error ?? 'Unknown'} — click to retry`">
            <template #activator="{ props: tooltipProps }">
              <v-btn
                v-bind="tooltipProps"
                icon
                size="x-small"
                variant="text"
                color="warning"
                class="ml-1"
                @click="checkForUpdate"
              >
                <v-icon size="x-small">mdi-alert-circle</v-icon>
              </v-btn>
            </template>
          </v-tooltip>
        </template>
      </div>

      <!-- Right section: Action buttons -->
      <div class="d-flex align-center ga-1">
        <template v-if="showFooterLinks">
          <v-btn
            icon="mdi-github"
            size="small"
            variant="text"
            aria-label="Open GitHub repository"
            @click="openGitHub"
          >
            <v-icon>mdi-github</v-icon>
            <v-tooltip activator="parent" location="top">GitHub</v-tooltip>
          </v-btn>
          <v-btn
            icon="mdi-license"
            size="small"
            variant="text"
            aria-label="View license"
            @click="openLicense"
          >
            <v-icon>mdi-license</v-icon>
            <v-tooltip activator="parent" location="top">License</v-tooltip>
          </v-btn>
          <v-btn
            :color="disclaimerAcknowledged ? 'success' : 'warning'"
            size="small"
            variant="text"
            aria-label="View disclaimer"
            @click="openDisclaimer"
          >
            <v-icon>{{ disclaimerAcknowledged ? 'mdi-shield-check' : 'mdi-shield-alert' }}</v-icon>
            <v-tooltip activator="parent" location="top">Disclaimer</v-tooltip>
          </v-btn>
          <v-btn
            icon="mdi-help-circle"
            size="small"
            variant="text"
            aria-label="Open FAQ"
            @click="openFAQ"
          >
            <v-icon>mdi-help-circle</v-icon>
            <v-tooltip activator="parent" location="top">FAQ</v-tooltip>
          </v-btn>
        </template>
        <v-menu v-else location="top">
          <template #activator="{ props }">
            <v-btn v-bind="props" icon size="small" variant="text" aria-label="More links">
              <v-icon>mdi-dots-horizontal</v-icon>
            </v-btn>
          </template>
          <v-list density="compact">
            <v-list-item prepend-icon="mdi-github" title="GitHub" @click="openGitHub" />
            <v-list-item prepend-icon="mdi-license" title="License" @click="openLicense" />
            <v-list-item
              :prepend-icon="disclaimerAcknowledged ? 'mdi-shield-check' : 'mdi-shield-alert'"
              title="Disclaimer"
              @click="openDisclaimer"
            />
            <v-list-item prepend-icon="mdi-help-circle" title="FAQ" @click="openFAQ" />
          </v-list>
        </v-menu>
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
import { useResponsiveLayout } from '../composables/useResponsiveLayout'
import { useAutoUpdate } from '../composables/useAutoUpdate'
import { useApiService } from '../composables/useApiService'

defineProps<{
  disclaimerAcknowledged: boolean
}>()

const emit = defineEmits<{
  'toggle-log-viewer': []
  'open-disclaimer': []
  'open-faq': []
}>()

// Responsive layout
const { showFooterLinks } = useResponsiveLayout()

// Auto-update
const { updateStatus, checkForUpdate, downloadUpdate, installUpdate } = useAutoUpdate()

// API service
const { api } = useApiService()

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

  if (api) {
    try {
      const versionInfo = await api.system.getVersion()
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
  if (api) {
    try {
      const result = await api.shell.openExternal('https://github.com/berntpopp/varlens')
      if (!result.success) {
        console.error('Failed to open GitHub URL:', result.error)
      }
    } catch (error) {
      console.error('Failed to open GitHub URL:', error)
    }
  }
}

const openLicense = async (): Promise<void> => {
  if (api) {
    try {
      const result = await api.shell.openExternal('https://opensource.org/licenses/MIT')
      if (!result.success) {
        console.error('Failed to open license URL:', result.error)
      }
    } catch (error) {
      console.error('Failed to open license URL:', error)
    }
  }
}
</script>
