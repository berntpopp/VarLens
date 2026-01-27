/* global localStorage */

// Declare Vite-injected global constant
declare const __APP_VERSION__: string

const STORAGE_KEY = 'varlens_disclaimer_acknowledged_version'

export function useVersionGating(): {
  currentVersion: string
  needsAcknowledgment: () => boolean
  recordAcknowledgment: () => void
  clearAcknowledgment: () => void
} {
  const currentVersion = __APP_VERSION__

  const needsAcknowledgment = (): boolean => {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored !== currentVersion
  }

  const recordAcknowledgment = (): void => {
    localStorage.setItem(STORAGE_KEY, currentVersion)
  }

  const clearAcknowledgment = (): void => {
    localStorage.removeItem(STORAGE_KEY)
  }

  return {
    currentVersion,
    needsAcknowledgment,
    recordAcknowledgment,
    clearAcknowledgment
  }
}
