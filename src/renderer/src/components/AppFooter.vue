<template>
  <v-footer app class="app-footer px-4 py-1" height="auto">
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
              :icon="isOnline ? mdiWifi : mdiWifiOff"
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
                <v-icon size="x-small" :icon="mdiRefresh" />
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
                <v-icon size="x-small" :icon="mdiArrowUpCircle" />
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
                <v-icon size="x-small" :icon="mdiDownload" />
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
                  <v-icon size="x-small" :icon="mdiRestart" />
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
                <v-icon size="x-small" :icon="mdiAlertCircle" />
              </v-btn>
            </template>
          </v-tooltip>
        </template>
      </div>

      <!-- Right section: Action buttons -->
      <div class="footer-actions d-flex align-center">
        <template v-if="showFooterLinks">
          <!-- External links group: GitHub, Docs, License -->
          <v-btn
            icon
            size="small"
            variant="text"
            aria-label="Open GitHub repository"
            @click="openGitHub"
          >
            <v-icon :icon="mdiGithub" />
            <v-tooltip activator="parent" location="top">GitHub</v-tooltip>
          </v-btn>
          <v-btn icon size="small" variant="text" aria-label="Open documentation" @click="openDocs">
            <v-icon :icon="mdiBookOpenVariant" />
            <v-tooltip activator="parent" location="top">Documentation</v-tooltip>
          </v-btn>
          <v-btn icon size="small" variant="text" aria-label="View license" @click="openLicense">
            <v-icon :icon="mdiLicense" />
            <v-tooltip activator="parent" location="top">License</v-tooltip>
          </v-btn>

          <v-divider vertical class="footer-divider" />

          <!-- App info group: Disclaimer, FAQ -->
          <v-btn
            icon
            :color="disclaimerAcknowledged ? 'success' : 'warning'"
            size="small"
            variant="text"
            aria-label="View disclaimer"
            @click="openDisclaimer"
          >
            <v-icon :icon="disclaimerAcknowledged ? mdiShieldCheck : mdiShieldAlert" />
            <v-tooltip activator="parent" location="top">Disclaimer</v-tooltip>
          </v-btn>
          <v-btn icon size="small" variant="text" aria-label="Open FAQ" @click="openFAQ">
            <v-icon :icon="mdiHelpCircle" />
            <v-tooltip activator="parent" location="top">FAQ</v-tooltip>
          </v-btn>

          <v-divider vertical class="footer-divider" />
        </template>
        <v-menu v-else location="top">
          <template #activator="{ props }">
            <v-btn v-bind="props" icon size="small" variant="text" aria-label="More links">
              <v-icon :icon="mdiDotsHorizontal" />
            </v-btn>
          </template>
          <v-list density="compact">
            <v-list-subheader>External Links</v-list-subheader>
            <v-list-item :prepend-icon="mdiGithub" title="GitHub" @click="openGitHub" />
            <v-list-item
              :prepend-icon="mdiBookOpenVariant"
              title="Documentation"
              @click="openDocs"
            />
            <v-list-item :prepend-icon="mdiLicense" title="License" @click="openLicense" />
            <v-divider class="my-1" />
            <v-list-subheader>App Info</v-list-subheader>
            <v-list-item
              :prepend-icon="disclaimerAcknowledged ? mdiShieldCheck : mdiShieldAlert"
              title="Disclaimer"
              @click="openDisclaimer"
            />
            <v-list-item :prepend-icon="mdiHelpCircle" title="FAQ" @click="openFAQ" />
          </v-list>
        </v-menu>

        <!-- Keyboard shortcuts help -->
        <v-btn
          icon
          size="small"
          variant="text"
          aria-label="Keyboard shortcuts"
          @click="$emit('open-shortcuts-help')"
        >
          <v-icon :icon="mdiKeyboard" />
          <v-tooltip activator="parent" location="top">Keyboard Shortcuts (?)</v-tooltip>
        </v-btn>

        <!-- Dev tool: Console -->
        <v-btn
          icon
          size="small"
          variant="text"
          aria-label="Toggle log viewer"
          @click="toggleLogViewer"
        >
          <v-badge :content="errorCount" :model-value="errorCount > 0" color="error" floating>
            <v-icon :icon="mdiConsole" />
          </v-badge>
          <v-tooltip activator="parent" location="top">Log Viewer</v-tooltip>
        </v-btn>
      </div>
    </div>
  </v-footer>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useLogStore } from '../stores/logStore'
import { useResponsiveLayout } from '../composables/useResponsiveLayout'
import { useAutoUpdate } from '../composables/useAutoUpdate'
import { useApiService } from '../composables/useApiService'
import { APP_CONFIG } from '../../../shared/config/app.config'
import { logService } from '../services/LogService'
import {
  mdiAlertCircle,
  mdiArrowUpCircle,
  mdiBookOpenVariant,
  mdiConsole,
  mdiDotsHorizontal,
  mdiDownload,
  mdiGithub,
  mdiHelpCircle,
  mdiKeyboard,
  mdiLicense,
  mdiRefresh,
  mdiRestart,
  mdiShieldAlert,
  mdiShieldCheck,
  mdiWifi,
  mdiWifiOff
} from '@mdi/js'

defineProps<{
  disclaimerAcknowledged: boolean
}>()

const emit = defineEmits<{
  'toggle-log-viewer': []
  'open-disclaimer': []
  'open-faq': []
  'open-shortcuts-help': []
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
      logService.error(
        'Failed to fetch version info: ' + (error instanceof Error ? error.message : String(error)),
        'app'
      )
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
      const result = await api.shell.openExternal(APP_CONFIG.URLS.GITHUB)
      if (!result.success) {
        logService.error('Failed to open GitHub URL: ' + String(result.error), 'app')
      }
    } catch (error) {
      logService.error(
        'Failed to open GitHub URL: ' + (error instanceof Error ? error.message : String(error)),
        'app'
      )
    }
  }
}

const openDocs = async (): Promise<void> => {
  if (api) {
    try {
      const result = await api.shell.openExternal(APP_CONFIG.URLS.DOCS)
      if (!result.success) {
        logService.error('Failed to open documentation URL: ' + String(result.error), 'app')
      }
    } catch (error) {
      logService.error(
        'Failed to open documentation URL: ' +
          (error instanceof Error ? error.message : String(error)),
        'app'
      )
    }
  }
}

const openLicense = async (): Promise<void> => {
  if (api) {
    try {
      const result = await api.shell.openExternal(APP_CONFIG.URLS.LICENSE)
      if (!result.success) {
        logService.error('Failed to open license URL: ' + String(result.error), 'app')
      }
    } catch (error) {
      logService.error(
        'Failed to open license URL: ' + (error instanceof Error ? error.message : String(error)),
        'app'
      )
    }
  }
}
</script>

<style scoped>
.app-footer {
  background-color: #dfe4ea !important;
  border-top: 1px solid #c8cfd8 !important;
}

.footer-actions {
  gap: 4px;
}

.footer-divider {
  height: 20px;
  margin: 0;
  opacity: 0.4;
}
</style>
