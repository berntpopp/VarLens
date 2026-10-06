/**
 * Makes Escape reliable for every Vuetify overlay — `v-menu`, `v-dialog`, and
 * the dropdowns Vuetify builds from them — with one window-level listener.
 *
 * The defect (Vuetify 4, `useStack` + `VOverlay`): an overlay closes on Escape
 * only while its `globalTop` flag is true, and Vuetify updates that flag from
 * a `setTimeout` after the overlay stack changed. Until the timer runs the
 * flags describe the previous stack, so an Escape that arrives in between is
 * - dropped by the overlay that just opened (it stays open), or
 * - taken by the overlay underneath (a dialog closes instead of the menu that
 *   just opened inside it), or
 * - dropped by the overlay that just became top-most because the one above it
 *   closed (a second quick Escape does nothing).
 * Input events are dispatched ahead of timers, so a quick key press on a busy
 * main thread hits this regularly (issue #452).
 *
 * The fix: while any overlay is open, an Escape is held back at the window
 * (capture phase, before Vuetify or anything else sees it) until Vue has
 * flushed and Vuetify's timer has run, and is then replayed on the element it
 * was aimed at. Vuetify handles the replay against a settled stack. Several
 * held keys are replayed one per settled stack, so each closes one layer.
 * With no overlay open nothing is intercepted.
 *
 * `useContextMenu` keeps its own listener: it also covers an Escape sent
 * before the menu has rendered at all, which this guard cannot see.
 */

import { nextTick } from 'vue'

const ACTIVE_OVERLAY_SELECTOR = '.v-overlay--active'

/** Resolves once Vue has flushed and timers queued by that flush have run. */
function overlayStackSettled(): Promise<void> {
  // Vuetify queues its timer during the flush; ours is queued after it and
  // timers of equal delay fire in the order they were set.
  return nextTick().then(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
}

function replayTarget(original: KeyboardEvent): EventTarget {
  const target = original.target
  if (target instanceof Node) {
    return target.isConnected ? target : (document.activeElement ?? document.body)
  }
  return target ?? window
}

function cloneKeydown(original: KeyboardEvent): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key: original.key,
    code: original.code,
    location: original.location,
    repeat: original.repeat,
    ctrlKey: original.ctrlKey,
    shiftKey: original.shiftKey,
    altKey: original.altKey,
    metaKey: original.metaKey,
    bubbles: true,
    cancelable: true,
    composed: true
  })
}

/**
 * Install the guard on `window`. Call once at application start; returns a
 * function that removes it.
 */
export function installOverlayEscapeGuard(): () => void {
  const replays = new WeakSet<Event>()
  const held: KeyboardEvent[] = []
  let draining = false
  let installed = true

  async function drain(): Promise<void> {
    draining = true
    try {
      while (held.length > 0) {
        await overlayStackSettled()
        const original = held.shift()
        if (original === undefined || !installed) continue
        const replay = cloneKeydown(original)
        replays.add(replay)
        replayTarget(original).dispatchEvent(replay)
      }
      // The last replay may have changed the stack again; keys that arrive
      // before it settles must queue behind it.
      await overlayStackSettled()
    } finally {
      draining = false
      if (held.length > 0 && installed) void drain()
    }
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || event.isComposing || replays.has(event)) return
    if (!draining && document.querySelector(ACTIVE_OVERLAY_SELECTOR) === null) return
    // Hold the key back: nobody may act on it against a stale overlay stack.
    event.stopImmediatePropagation()
    held.push(event)
    if (!draining) void drain()
  }

  window.addEventListener('keydown', onKeydown, { capture: true })

  return () => {
    installed = false
    held.length = 0
    window.removeEventListener('keydown', onKeydown, { capture: true })
  }
}
