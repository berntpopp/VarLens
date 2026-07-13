import { unwrapIpcResult, type IpcResult } from '../../../shared/types/errors'

type ZipCleanup = (extractionId: string) => Promise<IpcResult<void>>

export interface ZipExtractionLifecycle {
  track: (extractionId: string) => void
  cleanup: () => Promise<void>
}

/** Owns opaque ZIP extraction capabilities until targeted cleanup succeeds. */
export function useZipExtractionLifecycle(cleanupZipTemp: ZipCleanup): ZipExtractionLifecycle {
  const owned = new Set<string>()
  const inFlight = new Map<string, Promise<void>>()

  function track(extractionId: string): void {
    owned.add(extractionId)
  }

  function cleanupOne(extractionId: string): Promise<void> {
    const active = inFlight.get(extractionId)
    if (active !== undefined) return active

    const cleanup = (async (): Promise<void> => {
      unwrapIpcResult(await cleanupZipTemp(extractionId))
      owned.delete(extractionId)
    })()
    inFlight.set(extractionId, cleanup)
    const clearInFlight = (): void => {
      if (inFlight.get(extractionId) === cleanup) inFlight.delete(extractionId)
    }
    void cleanup.then(clearInFlight, clearInFlight)
    return cleanup
  }

  async function cleanup(): Promise<void> {
    await Promise.all([...owned].map(cleanupOne))
  }

  return { track, cleanup }
}
