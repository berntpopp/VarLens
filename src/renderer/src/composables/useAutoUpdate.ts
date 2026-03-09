import { ref, computed, onUnmounted } from 'vue'
import type { Ref, ComputedRef } from 'vue'
import type { UpdateStatus } from '../../../shared/types/api'
import { useApiService } from './useApiService'

export interface UseAutoUpdateReturn {
  updateStatus: Ref<UpdateStatus>
  isUpdateAvailable: ComputedRef<boolean>
  isUpdateDownloaded: ComputedRef<boolean>
  isDownloading: ComputedRef<boolean>
  checkForUpdate: () => Promise<void>
  downloadUpdate: () => Promise<void>
  installUpdate: () => Promise<void>
}

export function useAutoUpdate(): UseAutoUpdateReturn {
  const { api } = useApiService()
  const updateStatus = ref<UpdateStatus>({ state: 'idle' })
  let cleanup: (() => void) | null = null

  if (api) {
    // Fetch initial status
    api.updater.getStatus().then((status) => {
      updateStatus.value = status
    })

    // Listen for status changes
    cleanup = api.updater.onStatusChange((status: UpdateStatus) => {
      updateStatus.value = status
    })
  }

  onUnmounted(() => {
    if (cleanup) {
      cleanup()
      cleanup = null
    }
  })

  const isUpdateAvailable = computed(() => updateStatus.value.state === 'available')
  const isUpdateDownloaded = computed(() => updateStatus.value.state === 'downloaded')
  const isDownloading = computed(() => updateStatus.value.state === 'downloading')

  async function checkForUpdate(): Promise<void> {
    if (api) {
      await api.updater.checkForUpdate()
    }
  }

  async function downloadUpdate(): Promise<void> {
    if (api) {
      await api.updater.downloadUpdate()
    }
  }

  async function installUpdate(): Promise<void> {
    if (api) {
      await api.updater.installUpdate()
    }
  }

  return {
    updateStatus,
    isUpdateAvailable,
    isUpdateDownloaded,
    isDownloading,
    checkForUpdate,
    downloadUpdate,
    installUpdate
  }
}
