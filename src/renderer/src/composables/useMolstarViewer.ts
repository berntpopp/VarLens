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
import type {
  LollipopVariant,
  ClinVarVariant,
  ProteinStructureInfo
} from '../../../shared/types/protein'
import {
  getConsequenceColor,
  getClinVarCategory,
  CLINVAR_COLORS
} from '../../../shared/utils/protein-utils'
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
  variants: Ref<LollipopVariant[]>,
  clinvarVariants?: Ref<ClinVarVariant[]>
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
        // Delay highlighting slightly to ensure the visual API is fully initialized
        // after the loadComplete event fires
        setTimeout(() => highlightVariants(), 500)
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

    // Check if the structure is already loaded (event may have fired before
    // we subscribed). Inspect the plugin's structure hierarchy as a fallback.
    if (!structureLoaded.value) {
      try {
        const plugin = (viewerInstance as unknown as Record<string, unknown>).plugin as
          | { managers?: { structure?: { hierarchy?: { current?: { structures?: unknown[] } } } } }
          | undefined
        const structures = plugin?.managers?.structure?.hierarchy?.current?.structures
        if (structures !== undefined && structures.length > 0) {
          loading.value = false
          structureLoaded.value = true
          error.value = null
          setTimeout(() => highlightVariants(), 500)
          logService.info(
            '3D structure already loaded (detected via plugin state)',
            'MolstarViewer'
          )
        }
      } catch {
        // Ignore — structure state check is a best-effort fallback
      }
    }

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
   * Highlight variant residues on the 3D structure.
   * Uses the pdbe-molstar visual.select() API with struct_asym_id='A'
   * (chain A is the default for both AlphaFold and most PDB structures).
   * Colors each residue by its consequence category and dims unselected
   * residues with a light gray nonSelectedColor.
   */
  function highlightVariants(): void {
    if (!viewerInstance) return

    const variantsToHighlight = variants.value.filter((v) => v.proteinPosition > 0)

    // Build selection data for user variants
    const selections = variantsToHighlight.map((v) => ({
      struct_asym_id: 'A',
      start_residue_number: v.proteinPosition,
      end_residue_number: v.proteinPosition,
      color: hexToRgb(v.color),
      focus: false,
      sideChain: true
    }))

    // Add ClinVar P/LP variants (in red tones)
    const cvVariants = clinvarVariants?.value ?? []
    const userPositions = new Set(variantsToHighlight.map((v) => v.proteinPosition))
    for (const cv of cvVariants) {
      if (cv.proteinPosition === null || cv.proteinPosition <= 0) continue
      // Skip if already highlighted by user variant
      if (userPositions.has(cv.proteinPosition)) continue
      const cat = getClinVarCategory(cv.clinicalSignificance)
      selections.push({
        struct_asym_id: 'A',
        start_residue_number: cv.proteinPosition,
        end_residue_number: cv.proteinPosition,
        color: hexToRgb(CLINVAR_COLORS[cat]),
        focus: false,
        sideChain: true
      })
    }

    if (selections.length === 0) return

    logService.info(
      `Highlighting ${selections.length} residue(s) on 3D structure (${variantsToHighlight.length} user + ${selections.length - variantsToHighlight.length} ClinVar)`,
      'MolstarViewer'
    )

    try {
      viewerInstance.visual.select({
        data: selections,
        nonSelectedColor: { r: 220, g: 220, b: 220 }
      })
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

    // Find the variant at this position to use its actual color
    const variant = variants.value.find((v) => v.proteinPosition === position)
    const color = variant
      ? hexToRgb(variant.color)
      : hexToRgb(getConsequenceColor('missense_variant'))

    try {
      viewerInstance.visual.select({
        data: [
          {
            struct_asym_id: 'A',
            start_residue_number: position,
            end_residue_number: position,
            color,
            focus: true,
            sideChain: true
          }
        ],
        nonSelectedColor: { r: 220, g: 220, b: 220 }
      })
    } catch (err) {
      logService.error(
        `Failed to focus residue ${position}: ${err instanceof Error ? err.message : String(err)}`,
        'MolstarViewer'
      )
    }
  }

  /**
   * Switch the molecular representation type.
   *
   * Sets the `visual-style` attribute on the pdbe-molstar web component element,
   * then calls visual.update() to trigger a reload with the new style.
   * The custom-data-url and custom-data-format must be re-specified so
   * the component knows what structure to load with the new visual style.
   */
  function setRepresentation(type: RepresentationType): void {
    if (!viewerInstance) return
    activeRepresentation.value = type

    const el = molstarRef.value as PdbeMolstarElement | null
    if (!el) return

    try {
      // Read current structure data source from element attributes
      const customDataUrl = el.getAttribute('custom-data-url') ?? ''
      const customDataFormat = el.getAttribute('custom-data-format') ?? 'cif'

      // Set the visual-style attribute for the web component
      el.setAttribute('visual-style', type)

      // Trigger a full reload with the new visual style.
      // We must re-specify the data source since fullLoad=true clears it.
      const updateOptions: Record<string, unknown> = {
        visualStyle: type,
        customData: {
          url: customDataUrl,
          format: customDataFormat
        }
      }

      void viewerInstance.visual.update(updateOptions, true)
      logService.info(`Representation changed to ${type}`, 'MolstarViewer')

      // Re-apply variant highlighting after the representation change completes
      setTimeout(() => highlightVariants(), 2000)
    } catch (err) {
      logService.error(
        `Failed to change representation to ${type}: ${err instanceof Error ? err.message : String(err)}`,
        'MolstarViewer'
      )
    }
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

  // Re-highlight when ClinVar variants change
  if (clinvarVariants) {
    watch(clinvarVariants, () => {
      if (structureLoaded.value) {
        highlightVariants()
      }
    })
  }

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
