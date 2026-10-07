/**
 * Coalesce bursts of calls: the first call runs immediately, further calls
 * within `intervalMs` collapse into one trailing run, so the last call of a
 * burst is never dropped and `fn` runs at most once per interval.
 */
export function leadingTrailingThrottle(
  fn: () => void,
  intervalMs: number
): { call: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  let trailing = false

  const arm = (): void => {
    timer = setTimeout(() => {
      timer = null
      if (!trailing) return
      trailing = false
      fn()
      arm()
    }, intervalMs)
  }

  const call = (): void => {
    if (timer !== null) {
      trailing = true
      return
    }
    fn()
    arm()
  }

  const cancel = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    trailing = false
  }

  return { call, cancel }
}
