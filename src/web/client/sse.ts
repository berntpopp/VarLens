/**
 * Server-sent event bridge for web-mode `on*` subscriptions. One shared
 * EventSource serves every subscriber and closes with the last one.
 */
import { EVENTS_RESYNC_DOM_EVENT } from '../../shared/ipc/domains/jobs'
import { API_BASE } from './transport'

let sharedEventSource: EventSource | null = null
let sharedEventSourceSubscriberCount = 0

/**
 * The browser reconnects on its own and sends `Last-Event-ID`, so the server
 * replays what was missed; `events:resync` means it could not, and listeners
 * should re-poll. `session:revoked` (logout, deactivation, password reset) and
 * a permanently failed connection drop the shared source so the next
 * subscriber after re-login opens a fresh one.
 */
function getSharedEventSource(): EventSource | null {
  if (typeof EventSource === 'undefined') return null
  if (sharedEventSource === null) {
    const source = new EventSource(`${API_BASE}/events`, { withCredentials: true })
    const drop = (): void => {
      source.close()
      if (sharedEventSource === source) sharedEventSource = null
    }
    source.addEventListener('session:revoked', drop)
    source.addEventListener('error', () => {
      if (source.readyState === EventSource.CLOSED) drop()
    })
    source.addEventListener('events:resync', () => {
      window.dispatchEvent(new CustomEvent(EVENTS_RESYNC_DOM_EVENT))
    })
    sharedEventSource = source
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
