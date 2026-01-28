import { ref, onUnmounted } from 'vue'

const STORAGE_KEY = 'varlens_panel_width'
const DEFAULT_WIDTH = 400
const MIN_WIDTH = 300
const MAX_WIDTH = 800

export function usePanelResize() {
  // Load initial width from localStorage
  const storedWidth = localStorage.getItem(STORAGE_KEY)
  const initialWidth = storedWidth !== null ? parseInt(storedWidth, 10) : DEFAULT_WIDTH

  const panelWidth = ref(
    isNaN(initialWidth) ? DEFAULT_WIDTH : Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, initialWidth))
  )
  const isResizing = ref(false)

  let startX = 0
  let startWidth = 0

  const handleMouseMove = (e: MouseEvent): void => {
    if (!isResizing.value) return

    // For right drawer, delta is startX - currentX (moving left increases width)
    const delta = startX - e.clientX
    const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + delta))
    panelWidth.value = newWidth
  }

  const handleMouseUp = (): void => {
    if (!isResizing.value) return

    isResizing.value = false
    // Persist to localStorage
    localStorage.setItem(STORAGE_KEY, panelWidth.value.toString())
    // Remove event listeners
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', handleMouseUp)
  }

  const startResize = (e: MouseEvent): void => {
    isResizing.value = true
    startX = e.clientX
    startWidth = panelWidth.value

    // Add event listeners to document for smooth tracking
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  // Cleanup on component unmount
  onUnmounted(() => {
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', handleMouseUp)
  })

  return {
    panelWidth,
    isResizing,
    startResize,
    minWidth: MIN_WIDTH,
    maxWidth: MAX_WIDTH
  }
}
