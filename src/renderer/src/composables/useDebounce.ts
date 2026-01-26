import { onBeforeUnmount } from 'vue'

export function useDebounce<T extends (...args: Parameters<T>) => void>(
  fn: T,
  delay: number
): { debouncedFn: T; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null

  const cancel = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  const debouncedFn = ((...args: Parameters<T>) => {
    cancel()
    timer = setTimeout(() => {
      fn(...args)
    }, delay)
  }) as T

  // Auto-cleanup on component unmount
  onBeforeUnmount(cancel)

  return { debouncedFn, cancel }
}
