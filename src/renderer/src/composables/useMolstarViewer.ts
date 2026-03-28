/**
 * Composable for managing pdbe-molstar Web Component lifecycle
 * Handles structure loading, variant highlighting, and viewer controls
 *
 * pdbe-molstar exposes a `.viewerInstance` property whose
 * `events.loadComplete` is an RxJS observable that fires when the
 * structure finishes loading. We use a MutationObserver + polling
 * approach to reliably detect when the viewer is ready.
 */

import { ref, watch, onBeforeUnmount, markRaw, type Ref } from 'vue'
import type { LollipopVariant, ProteinStructureInfo } from '../../../shared/types/protein'
import { getConsequenceColor } from '../../../shared/utils/protein-utils'
import { logService } from '../services/LogService'

/** Representation types supported by pdbe-molstar */
export type RepresentationType = 'cartoon' | 'molecular-surface' | 'ball-and-stick'

/** pdbe-molstar viewer instance (partial typing for the API we use) */
interface MolstarViewerInstance {
  events: {
    loadComplete: {
      subscribe: (callback: (success: boolean) => void) => { unsubscribe: () => void }
    }
  }
  visual: {
    select: (params: {
      data: Array<{
        struct_asym_id?: string
        start_residue_number: number
        end_residue_number: number
        color: { r: number; g: number; b: number }
        focus?: boolean
        sideChain?: boolean
      }>
      nonSelectedColor?: { r: number; g: number; b: number }
    }) => void
    reset: (params: { camera: boolean; theme: boolean }) => void
    update: (options: Record<string, unknown>, fullLoad?: boolean) => void | Promise<void>
  }
  canvas: {
    setBgColor: (color: { r: number; g: number; b: number }) => void
  }
}

/** pdbe-molstar custom element with viewer instance */
interface PdbeMolstarElement extends HTMLElement {
  viewerInstance?: MolstarViewerInstance
}

/**
 * Parse a hex color string to RGB components (0-255)
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!result) return { r: 128, g: 128, b: 128 }
  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  }
}

/**
 * Composable for pdbe-molstar 3D protein structure viewer
 *
 * @param molstarRef - Ref to the <pdbe-molstar> DOM element
 * @param structureInfo - Reactive protein structure info
 * @param variants - Reactive array of lollipop variants to highlight
 */
export function useMolstarViewer(
  molstarRef: Ref<HTMLElement | null>,
  structureInfo: Ref<ProteinStructureInfo | null>,
  variants: Ref<LollipopVariant[]>
) {
  const loading = ref(false)
  const error = ref<string | null>(null)
  const structureLoaded = ref(false)
  const activeRepresentation = ref<RepresentationType>('cartoon')

  // Store viewer instance outside Vue reactivity (WebGL objects break with proxies)
  let viewerInstance: MolstarViewerInstance | null = null
  let loadSubscription: { unsubscribe: () => void } | null = null
  let pollingTimer: ReturnType<typeof setInterval> | null = null

  /**
   * Attempt to grab the viewer instance from the custom element and
   * subscribe to load events.
   */
  function tryAttachViewer(): boolean {
    const el = molstarRef.value as PdbeMolstarElement | null
    if (!el?.viewerInstance) return false

    // Already attached
    if (viewerInstance === el.viewerInstance) return true

    viewerInstance = markRaw(el.viewerInstance) as MolstarViewerInstance

    // Subscribe to load complete
    loadSubscription?.unsubscribe()
    loadSubscription = viewerInstance.events.loadComplete.subscribe((success: boolean) => {
      if (success) {
        loading.value = false
        structureLoaded.value = true
        error.value = null
        highlightVariants()
        logService.info('3D structure loaded successfully', 'MolstarViewer')
      } else {
        loading.value = false
        structureLoaded.value = false
        error.value = 'Failed to load 3D structure'
        logService.error('3D structure load returned failure', 'MolstarViewer')
      }

      // Stop polling once we get a result
      stopPolling()
    })

    return true
  }

  /**
   * Poll for the viewer instance to become available.
   * The pdbe-molstar web component initializes asynchronously, so
   * viewerInstance may not be available immediately after DOM insertion.
   */
  function startPolling(): void {
    stopPolling()
    let attempts = 0
    const maxAttempts = 60 // 30 seconds max

    pollingTimer = setInterval(() => {
      attempts++
      if (tryAttachViewer()) {
        stopPolling()
        return
      }
      if (attempts >= maxAttempts) {
        stopPolling()
        loading.value = false
        error.value = 'Timed out waiting for 3D viewer to initialize'
        logService.error('pdbe-molstar viewer instance not found after timeout', 'MolstarViewer')
      }
    }, 500)
  }

  function stopPolling(): void {
    if (pollingTimer !== null) {
      clearInterval(pollingTimer)
      pollingTimer = null
    }
  }

  /**
   * Highlight missense variant residues on the 3D structure
   */
  function highlightVariants(): void {
    if (!viewerInstance) return

    const missenseVariants = variants.value.filter(
      (v) => v.consequenceCategory === 'missense' && v.proteinPosition > 0
    )
    if (missenseVariants.length === 0) return

    const selections = missenseVariants.map((v) => ({
      start_residue_number: v.proteinPosition,
      end_residue_number: v.proteinPosition,
      color: hexToRgb(getConsequenceColor(v.consequence)),
      sideChain: true
    }))

    try {
      viewerInstance.visual.select({ data: selections })
    } catch (err) {
      logService.error(
        `Failed to highlight variants: ${err instanceof Error ? err.message : String(err)}`,
        'MolstarViewer'
      )
    }
  }

  /**
   * Focus the camera on a specific residue position
   */
  function focusResidue(position: number): void {
    if (!viewerInstance) return

    try {
      viewerInstance.visual.select({
        data: [
          {
            start_residue_number: position,
            end_residue_number: position,
            color: hexToRgb(getConsequenceColor('missense_variant')),
            focus: true,
            sideChain: true
          }
        ]
      })
    } catch (err) {
      logService.error(
        `Failed to focus residue ${position}: ${err instanceof Error ? err.message : String(err)}`,
        'MolstarViewer'
      )
    }
  }

  /**
   * Switch the molecular representation type
   */
  function setRepresentation(type: RepresentationType): void {
    if (!viewerInstance) return
    activeRepresentation.value = type
    logService.info(`Representation changed to ${type}`, 'MolstarViewer')
  }

  /**
   * Reset the camera to the default view
   */
  function resetView(): void {
    if (!viewerInstance) return

    try {
      viewerInstance.visual.reset({ camera: true, theme: true })
      highlightVariants()
    } catch (err) {
      logService.error(
        `Failed to reset view: ${err instanceof Error ? err.message : String(err)}`,
        'MolstarViewer'
      )
    }
  }

  // Watch for the DOM element reference changes
  watch(
    molstarRef,
    (newEl) => {
      if (newEl) {
        // Start polling for viewer instance
        loading.value = true
        startPolling()
      } else {
        stopPolling()
        loadSubscription?.unsubscribe()
        loadSubscription = null
        viewerInstance = null
      }
    },
    { immediate: true }
  )

  // Watch structure info changes to trigger loading state
  watch(
    structureInfo,
    (newInfo) => {
      if (newInfo !== null) {
        loading.value = true
        structureLoaded.value = false
        error.value = null
        viewerInstance = null
        loadSubscription?.unsubscribe()
        loadSubscription = null

        // Wait for DOM update then start polling
        setTimeout(() => startPolling(), 100)
      }
    },
    { deep: true }
  )

  // Re-highlight when variants change
  watch(variants, () => {
    if (structureLoaded.value) {
      highlightVariants()
    }
  })

  onBeforeUnmount(() => {
    stopPolling()
    loadSubscription?.unsubscribe()
    loadSubscription = null
    viewerInstance = null
  })

  return {
    loading,
    error,
    structureLoaded,
    activeRepresentation,
    focusResidue,
    setRepresentation,
    resetView
  }
}
