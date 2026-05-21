import { ipcRenderer, type IpcRendererEvent } from 'electron'

type EventCallback<T> = (payload: T) => void

export function subscribeToIpcEvent<T>(channel: string, callback: EventCallback<T>): () => void {
  const handler = (_event: IpcRendererEvent, payload: T): void => {
    callback(payload)
  }
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

type RendererPerfRequestAction = 'get' | 'reset'

export function requestRendererPerfSnapshot(action: RendererPerfRequestAction): Promise<unknown> {
  return new Promise((resolve) => {
    const requestId = `perf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const handleResponse = (event: Event) => {
      const customEvent = event as CustomEvent<{ id: string; payload: unknown }>
      if (customEvent.detail?.id !== requestId) return
      window.removeEventListener('varlens:perf-response', handleResponse as EventListener)
      resolve(customEvent.detail.payload)
    }

    window.addEventListener('varlens:perf-response', handleResponse as EventListener)
    window.dispatchEvent(
      new CustomEvent('varlens:perf-request', {
        detail: {
          id: requestId,
          action
        }
      })
    )
  })
}
