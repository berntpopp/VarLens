/**
 * Server-sent event bridge for web-mode `on*` subscriptions. One shared
 * EventSource serves every subscriber and closes with the last one.
 */
import { API_BASE } from './transport'

let sharedEventSource: EventSource | null = null
let sharedEventSourceSubscriberCount = 0

function getSharedEventSource(): EventSource | null {
  if (typeof EventSource === 'undefined') return null
  if (sharedEventSource === null) {
    sharedEventSource = new EventSource(`${API_BASE}/events`, { withCredentials: true })
  }
  return sharedEventSource
}

export function subscribeWebEvent<T>(type: string, callback: (payload: T) => void): () => void {
  const source = getSharedEventSource()
  if (source === null) return () => {}

  const listener = (event: MessageEvent<string>): void => {
    callback(JSON.parse(event.data) as T)
  }
  source.addEventListener(type, listener as EventListener)
  sharedEventSourceSubscriberCount += 1

  let unsubscribed = false
  return () => {
    if (unsubscribed) return
    unsubscribed = true

    source.removeEventListener(type, listener as EventListener)
    sharedEventSourceSubscriberCount = Math.max(0, sharedEventSourceSubscriberCount - 1)
    if (sharedEventSourceSubscriberCount === 0 && sharedEventSource === source) {
      source.close()
      sharedEventSource = null
    }
  }
}
