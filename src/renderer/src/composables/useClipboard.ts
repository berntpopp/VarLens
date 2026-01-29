/**
 * Composable for clipboard operations with visual feedback
 */

import { ref } from 'vue'

/**
 * Provides clipboard copy functionality with state tracking
 * @returns Object with copy function and reactive state
 */
export function useClipboard() {
  const copied = ref(false)
  const error = ref<string | null>(null)

  /**
   * Copy text to clipboard
   * @param text - Text to copy
   * @returns Promise<boolean> - true if successful, false otherwise
   */
  async function copy(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text)
      copied.value = true
      error.value = null
      setTimeout(() => {
        copied.value = false
      }, 2000)
      return true
    } catch (e) {
      error.value = 'Failed to copy to clipboard'
      copied.value = false
      console.error('Clipboard error:', e)
      return false
    }
  }

  return { copy, copied, error }
}
