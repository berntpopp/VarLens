import { ref, computed, onUnmounted } from 'vue'
import type { Ref, ComputedRef } from 'vue'
import type { UpdateStatus } from '../../../shared/types/api'
import { isIpcError, unwrapIpcResult } from '../../../shared/types/errors'
import { logService } from '../services/LogService'
import { useApiService } from './useApiService'

function formatError(err: unknown): string {
  return isIpcError(err)
    ? (err.userMessage ?? err.message)
    : err instanceof Error
      ? err.message
      : String(err)
}
import { useCapabilityStore } from '../stores/capabilityStore'

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
  // The auto-updater is desktop-only (capability `autoUpdate`); the web
  // deployment updates itself, so the status stays idle there.
  const api = useCapabilityStore().canUse('autoUpdate') ? useApiService().api : undefined
  const updateStatus = ref<UpdateStatus>({ state: 'idle' })
  let cleanup: (() => void) | null = null

  if (api) {
    // Fetch initial status
    api.updater
      .getStatus()
      .then((res) => {
        try {
          updateStatus.value = unwrapIpcResult(res)
        } catch (err) {
          logService.error(`Failed to get initial updater status: ${formatError(err)}`, 'updater')
        }
      })
      .catch((err) => {
        logService.error(`Failed to invoke getStatus: ${formatError(err)}`, 'updater')
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
      try {
        unwrapIpcResult(await api.updater.checkForUpdate())
      } catch (err) {
        logService.error(`Failed to check for update: ${formatError(err)}`, 'updater')
      }
    }
  }

  async function downloadUpdate(): Promise<void> {
    if (api) {
      try {
        unwrapIpcResult(await api.updater.downloadUpdate())
      } catch (err) {
        logService.error(`Failed to download update: ${formatError(err)}`, 'updater')
      }
    }
  }

  async function installUpdate(): Promise<void> {
    if (api) {
      try {
        unwrapIpcResult(await api.updater.installUpdate())
      } catch (err) {
        logService.error(`Failed to install update: ${formatError(err)}`, 'updater')
      }
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
