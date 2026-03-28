/**
 * Generic ResizeObserver composable
 *
 * Tracks the dimensions of an HTML element reactively using ResizeObserver.
 * Cleans up on component unmount.
 */

import { ref, onMounted, onUnmounted, type Ref } from 'vue'

export interface Dimensions {
  width: number
  height: number
}

/**
 * Observe the size of an element and return reactive dimensions
 *
 * @param target - Ref to the HTML element to observe
 * @returns Reactive dimensions object
 */
export function useResizeObserver(target: Ref<HTMLElement | null>): {
  dimensions: Ref<Dimensions>
} {
  const dimensions = ref<Dimensions>({ width: 0, height: 0 })
  let observer: ResizeObserver | null = null

  const updateDimensions = (): void => {
    if (target.value) {
      const rect = target.value.getBoundingClientRect()
      dimensions.value = { width: rect.width, height: rect.height }
    }
  }

  onMounted(() => {
    // Initialize with current dimensions
    updateDimensions()

    // Observe for changes
    observer = new ResizeObserver(() => {
      updateDimensions()
    })

    if (target.value) {
      observer.observe(target.value)
    }
  })

  onUnmounted(() => {
    if (observer) {
      observer.disconnect()
      observer = null
    }
  })

  return { dimensions }
}
