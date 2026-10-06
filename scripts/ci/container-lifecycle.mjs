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

  function close() {
    closing ??= (async () => {
      signal?.removeEventListener('abort', interrupted)
      signals.removeListener('SIGINT', interrupted)
      signals.removeListener('SIGTERM', interrupted)
      const errors = []
      for (const remove of cleanup.reverse()) {
        try {
          await remove()
        } catch (error) {
          errors.push(error)
        }
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
