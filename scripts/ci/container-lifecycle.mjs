/** A resource scope owns only names allocated by this invocation. */
export function containerScope({ signal, signals = process } = {}) {
  const controller = new AbortController()
  const cleanup = []
  let closing
  let ready = false
  const interrupted = () => {
    controller.abort(new Error('Container validation cancelled'))
    // Callers still observe the aborted command; cleanup also starts while a
    // returned PostgreSQL service is idle. close() preserves cleanup failures.
    if (ready) void close().catch(() => {})
  }
  signal?.throwIfAborted()
  signal?.addEventListener('abort', interrupted, { once: true })
  signals.on('SIGINT', interrupted)
  signals.on('SIGTERM', interrupted)
  signals.on('SIGHUP', interrupted)

  function close() {
    closing ??= (async () => {
      const errors = []
      try {
        for (const remove of cleanup.reverse()) {
          try {
            await remove()
          } catch (error) {
            errors.push(error)
          }
        }
      } finally {
        // Unsubscribe only now: a repeated signal during removal must still be
        // handled, or the default action kills the process mid-cleanup.
        signal?.removeEventListener('abort', interrupted)
        signals.removeListener('SIGINT', interrupted)
        signals.removeListener('SIGTERM', interrupted)
        signals.removeListener('SIGHUP', interrupted)
      }
      if (errors.length) throw new AggregateError(errors, 'Owned container resource cleanup failed')
    })()
    return closing
  }
  return {
    signal: controller.signal,
    defer: (remove) => cleanup.push(remove),
    ready() {
      controller.signal.throwIfAborted()
      ready = true
    },
    close
  }
}
