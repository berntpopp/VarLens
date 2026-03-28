/**
 * Composable for managing pdbe-molstar Web Component lifecycle
 * Handles structure loading, variant highlighting, and viewer controls
 */

import { ref, watch, onBeforeUnmount, markRaw, type Ref } from 'vue'
import type { LollipopVariant, ProteinStructureInfo } from '../../../shared/types/protein'
import { getConsequenceColor } from '../../../shared/utils/protein-utils'
import { logService } from '../services/LogService'

/** Representation types supported by pdbe-molstar */
export type RepresentationType = 'cartoon' | 'molecular-surface' | 'ball-and-stick'

/** pdbe-molstar viewer instance (partial typing for the API we use) */
interface MolstarViewerInstance {
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

  /**
   * Handle the PDB.molstar.loaded event: highlight variant residues
   */
  function onMolstarLoaded(): void {
    loading.value = false
    structureLoaded.value = true
    error.value = null

    // Grab the viewer instance from the custom element
    const el = molstarRef.value as HTMLElement & { viewerInstance?: MolstarViewerInstance }
    if (el?.viewerInstance) {
      viewerInstance = markRaw(el.viewerInstance) as MolstarViewerInstance
      highlightVariants()
    }

    logService.info('3D structure loaded successfully', 'MolstarViewer')
  }

  /**
   * Handle load errors
   */
  function onMolstarError(event: Event): void {
    loading.value = false
    structureLoaded.value = false
    const detail = (event as CustomEvent)?.detail
    error.value = detail?.message ?? 'Failed to load 3D structure'
    logService.error(`3D structure load error: ${error.value}`, 'MolstarViewer')
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
    // pdbe-molstar does not expose a direct representation toggle via the JS API,
    // so we re-initialize the viewer with updated options through the element attribute approach.
    // For now, we store the preference; the component re-renders the element with the attribute.
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

  /**
   * Attach event listeners to the pdbe-molstar element
   */
  function attachListeners(el: HTMLElement): void {
    el.addEventListener('PDB.molstar.loaded', onMolstarLoaded)
    el.addEventListener('PDB.molstar.error', onMolstarError)
  }

  /**
   * Detach event listeners from the pdbe-molstar element
   */
  function detachListeners(el: HTMLElement): void {
    el.removeEventListener('PDB.molstar.loaded', onMolstarLoaded)
    el.removeEventListener('PDB.molstar.error', onMolstarError)
  }

  // Watch for the DOM element reference to attach listeners
  watch(
    molstarRef,
    (newEl, oldEl) => {
      if (oldEl) detachListeners(oldEl)
      if (newEl) attachListeners(newEl)
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
    if (molstarRef.value) {
      detachListeners(molstarRef.value)
    }
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
