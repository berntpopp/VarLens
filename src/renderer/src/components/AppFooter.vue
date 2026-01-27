<template>
  <v-footer app color="#E5AA94" class="px-4 py-1" height="auto">
    <div class="d-flex align-center justify-space-between" style="width: 100%">
      <!-- Left section: Version menu -->
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
        <v-badge :content="errorCount" :model-value="errorCount > 0" color="error" overlap>
          <v-btn
            icon="mdi-console"
            size="small"
            variant="text"
            aria-label="Toggle log viewer"
            @click="toggleLogViewer"
          />
        </v-badge>
      </div>
    </div>
  </v-footer>
</template>

<script setup lang="ts">
/* global window, console */
import { ref, computed, onMounted } from 'vue'
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

// Log store integration
const logStore = useLogStore()
const { stats } = storeToRefs(logStore)
const errorCount = computed(() => stats.value.errorCount + stats.value.criticalCount)

// Lifecycle: fetch version info on mount
onMounted(async () => {
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
