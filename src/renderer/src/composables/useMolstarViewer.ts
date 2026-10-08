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
import type { PDBeMolstarPlugin } from 'pdbe-molstar/lib/viewer'
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
import { formatError } from '../utils/ipc-result'

/**
 * Check if WebGL is available in the current environment.
 * Returns the context type ('webgl2' | 'webgl') or null if unavailable.
 */
function checkWebGLSupport(): string | null {
  try {
    const canvas = document.createElement('canvas')
    if (canvas.getContext('webgl2')) return 'webgl2'
    if (canvas.getContext('webgl')) return 'webgl'
    return null
  } catch {
    return null
  }
}

type MolstarViewerModule = typeof import('pdbe-molstar/lib/viewer')

let molstarRuntimePromise: Promise<MolstarViewerModule> | null = null
async function ensureMolstarRuntime(): Promise<MolstarViewerModule> {
  if (molstarRuntimePromise) return molstarRuntimePromise

  molstarRuntimePromise = Promise.all([
    import('pdbe-molstar/build/pdbe-molstar-light.css'),
    import('pdbe-molstar/lib/viewer')
  ])
    .then(([, viewerModule]) => {
      logService.info('pdbe-molstar runtime loaded via Vite asset graph', 'MolstarViewer')
      return viewerModule
    })
    .catch((error) => {
      molstarRuntimePromise = null
      throw error
    })

  return molstarRuntimePromise
}

/** Representation types supported by pdbe-molstar */
export type RepresentationType = 'cartoon' | 'molecular-surface' | 'ball-and-stick'

/** How variant residues are rendered on the structure */
export type VariantStyle = 'colored' | 'ball-and-stick'

/** RGB color value */
type RgbColor = { r: number; g: number; b: number }

/** pdbe-molstar selection data item */
interface SelectionDataItem {
  struct_asym_id?: string
  start_residue_number: number
  end_residue_number: number
  color: RgbColor
  focus?: boolean
  sideChain?: boolean
  representation?: string
  representationColor?: RgbColor
}

type MolstarViewerInstance = PDBeMolstarPlugin

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
 * @param molstarRef - Ref to the viewer mount container element
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
  const variantStyle = ref<VariantStyle>('colored')

  // Store viewer instance outside Vue reactivity (WebGL objects break with proxies)
  let viewerInstance: MolstarViewerInstance | null = null
  let loadSubscription: { unsubscribe: () => void } | null = null
  let activeInitToken = 0

  /** The warm-light background color used across the panel */
  const BG_COLOR = { r: 250, g: 248, b: 246 }

  /**
   * Restore the background color on the canvas via the pdbe-molstar canvas API.
   * Called after structure load to ensure the background matches our theme.
   */
  function restoreBgColor(): void {
    if (viewerInstance?.canvas) {
      viewerInstance.canvas.setBgColor(BG_COLOR)
    }
  }

  function attachViewer(viewer: MolstarViewerInstance): void {
    viewerInstance = markRaw(viewer) as MolstarViewerInstance
    // Subscribe to load complete
    loadSubscription?.unsubscribe()
    loadSubscription = viewerInstance.events.loadComplete.subscribe((success: boolean) => {
      if (success) {
        loading.value = false
        structureLoaded.value = true
        error.value = null
        // Restore background color after every load (including representation changes
        // that use fullLoad=true, which resets the canvas bg to black)
        restoreBgColor()
        setTimeout(() => restoreBgColor(), 300)
        // Delay highlighting slightly to ensure the visual API is fully initialized
        // after the loadComplete event fires
        setTimeout(() => void highlightVariants(), 500)
        logService.info('3D structure loaded successfully', 'MolstarViewer')
      } else {
        loading.value = false
        structureLoaded.value = false
        error.value = 'Failed to load 3D structure'
        logService.error('3D structure load returned failure', 'MolstarViewer')
      }
    })
  }

  function getInitParams(): {
    customData: { url: string; format: string; binary: boolean }
    visualStyle: RepresentationType
    hideControls: true
    landscape: true
    bgColor: RgbColor
    alphafoldView: boolean
    sequencePanel: false
    leftPanel: false
    rightPanel: false
    logPanel: false
    loadingOverlay: false
    selectInteraction: false
  } | null {
    const activeSource = structureInfo.value?.alphafold ?? structureInfo.value?.pdb
    if (!activeSource) return null

    return {
      customData: {
        url: activeSource.url,
        format: activeSource.format,
        binary: activeSource.format === 'bcif'
      },
      visualStyle: activeRepresentation.value,
      hideControls: true,
      landscape: true,
      bgColor: BG_COLOR,
      alphafoldView: activeSource.source === 'alphafold',
      sequencePanel: false,
      leftPanel: false,
      rightPanel: false,
      logPanel: false,
      loadingOverlay: false,
      selectInteraction: false
    }
  }

  async function teardownViewer(invalidatePendingInit = true): Promise<void> {
    if (invalidatePendingInit) {
      activeInitToken++
    }
    loadSubscription?.unsubscribe()
    loadSubscription = null

    const instance = viewerInstance
    viewerInstance = null

    if (instance) {
      try {
        await instance.clear()
      } catch (err) {
        logService.warn(
          `Failed to clear pdbe-molstar instance: ${formatError(err)}`,
          'MolstarViewer'
        )
      }
    }
  }

  async function startViewer(): Promise<void> {
    const container = molstarRef.value
    const initParams = getInitParams()

    if (!container || !initParams) return

    const initToken = activeInitToken + 1
    activeInitToken = initToken

    // Phase -1: Verify WebGL is available before loading the 6 MB script.
    const webglContext = checkWebGLSupport()
    if (webglContext === null) {
      loading.value = false
      error.value =
        '3D viewer requires WebGL which is not available. ' +
        'Try updating your GPU drivers, or launch VarLens with the --disable-gpu flag.'
      logService.error(
        'WebGL is not available — canvas.getContext() returned null for both webgl2 and webgl',
        'MolstarViewer'
      )
      return
    }
    logService.info(`WebGL available: ${webglContext}`, 'MolstarViewer')

    loading.value = true
    error.value = null
    structureLoaded.value = false

    try {
      await teardownViewer(false)
      container.replaceChildren()
      const { PDBeMolstarPlugin } = await ensureMolstarRuntime()
      if (initToken !== activeInitToken || container !== molstarRef.value) return

      const nextViewer = new PDBeMolstarPlugin()
      attachViewer(nextViewer)
      await nextViewer.render(container, initParams)
      if (initToken !== activeInitToken || container !== molstarRef.value) return

      restoreBgColor()
      logService.info(
        `pdbe-molstar viewer mounted directly into renderer container ` +
          `(source=${initParams.customData.format}, style=${initParams.visualStyle})`,
        'MolstarViewer'
      )
    } catch (err) {
      loading.value = false
      error.value =
        '3D viewer component failed to load. ' +
        'Try restarting the application. If the problem persists, try launching with --disable-gpu flag.'
      logService.error(
        `pdbe-molstar init failed: ${formatError(err)} ` +
          `(webgl=${webglContext}, userAgent=${navigator.userAgent})`,
        'MolstarViewer'
      )
    }
  }

  /**
   * Highlight variant residues on the 3D structure.
   * Uses the pdbe-molstar visual.select() API with struct_asym_id='A'
   * (chain A is the default for both AlphaFold and most PDB structures).
   * Colors each residue by its consequence category and dims unselected
   * residues with a light gray nonSelectedColor.
   *
   * In "ball-and-stick" mode, sets `sideChain: true` so pdbe-molstar creates
   * an additional ball-and-stick StructureComponent for selected residues
   * (on top of the existing cartoon). The `representationColor` is set to the
   * variant color so the sticks are visually distinct from the gray background.
   */
  async function highlightVariants(): Promise<void> {
    if (!viewerInstance) return

    const variantsToHighlight = variants.value.filter((v) => v.proteinPosition > 0)

    const useBallAndStick = variantStyle.value === 'ball-and-stick'

    // Build selection data for user variants.
    // In ball-and-stick mode: sideChain=true triggers pdbe-molstar to add a
    // ball-and-stick StructureComponent; representationColor colors the sticks.
    // In colored mode: only overpaint (coloring) is applied to the main representation.
    const selections: SelectionDataItem[] = variantsToHighlight.map((v) => {
      const color = hexToRgb(v.color)
      return {
        struct_asym_id: 'A',
        start_residue_number: v.proteinPosition,
        end_residue_number: v.proteinPosition,
        color,
        focus: false,
        sideChain: useBallAndStick,
        ...(useBallAndStick ? { representationColor: color } : {})
      }
    })

    // Add ClinVar P/LP variants (in red tones)
    const cvVariants = clinvarVariants?.value ?? []
    const userPositions = new Set(variantsToHighlight.map((v) => v.proteinPosition))
    for (const cv of cvVariants) {
      if (cv.proteinPosition === null || cv.proteinPosition <= 0) continue
      // Skip if already highlighted by user variant
      if (userPositions.has(cv.proteinPosition)) continue
      const cat = getClinVarCategory(cv.clinicalSignificance)
      const color = hexToRgb(CLINVAR_COLORS[cat])
      selections.push({
        struct_asym_id: 'A',
        start_residue_number: cv.proteinPosition,
        end_residue_number: cv.proteinPosition,
        color,
        focus: false,
        sideChain: useBallAndStick,
        ...(useBallAndStick ? { representationColor: color } : {})
      })
    }

    if (selections.length === 0) return

    logService.info(
      `Highlighting ${selections.length} residue(s) on 3D structure` +
        ` (${variantsToHighlight.length} user + ${selections.length - variantsToHighlight.length} ClinVar)` +
        ` style=${variantStyle.value}`,
      'MolstarViewer'
    )

    try {
      await viewerInstance.visual.select({
        data: selections,
        nonSelectedColor: { r: 220, g: 220, b: 220 }
      })
    } catch (err) {
      logService.error(`Failed to highlight variants: ${formatError(err)}`, 'MolstarViewer')
    }
  }

  /**
   * Focus the camera on a specific residue position.
   * Always shows side chains as ball-and-stick for the focused residue.
   */
  async function focusResidue(position: number): Promise<void> {
    if (!viewerInstance) return

    // Find the variant at this position to use its actual color
    const variant = variants.value.find((v) => v.proteinPosition === position)
    const color = variant
      ? hexToRgb(variant.color)
      : hexToRgb(getConsequenceColor('missense_variant'))

    try {
      await viewerInstance.visual.select({
        data: [
          {
            struct_asym_id: 'A',
            start_residue_number: position,
            end_residue_number: position,
            color,
            focus: true,
            sideChain: true,
            representationColor: color
          }
        ],
        nonSelectedColor: { r: 220, g: 220, b: 220 }
      })
    } catch (err) {
      logService.error(`Failed to focus residue ${position}: ${formatError(err)}`, 'MolstarViewer')
    }
  }

  /**
   * Switch the molecular representation type.
   *
   * Updates the activeRepresentation ref which triggers the MolstarViewer
   * component to recreate the viewer mount container with a new :key.
   * This avoids the pdbe-molstar fullLoad bug where visual updates can reset
   * the WebGL background to black and setBgColor cannot reliably restore it.
   * A fresh plugin mount consistently restores the expected background/theme.
   */
  function setRepresentation(type: RepresentationType): void {
    activeRepresentation.value = type
    // The element will be recreated by Vue's :key mechanism.
    // The loadComplete handler will re-apply variant highlighting.
    // Reset viewer instance since the old element will be destroyed.
    viewerInstance = null
    loadSubscription?.unsubscribe()
    loadSubscription = null
    loading.value = true
    structureLoaded.value = false
    logService.info(`Representation changed to ${type} (element recreated)`, 'MolstarViewer')
  }

  /**
   * Switch between colored-only and ball-and-stick rendering for variant residues
   */
  function setVariantStyle(style: VariantStyle): void {
    variantStyle.value = style
    logService.info(`Variant style changed to ${style}`, 'MolstarViewer')
    if (structureLoaded.value) {
      void highlightVariants()
    }
  }

  /**
   * Reset the camera to the default view
   */
  function resetView(): void {
    if (!viewerInstance) return

    try {
      viewerInstance.visual.reset({ camera: true, theme: true })
      void highlightVariants()
    } catch (err) {
      logService.error(`Failed to reset view: ${formatError(err)}`, 'MolstarViewer')
    }
  }

  // Watch for the DOM element reference changes
  watch(
    molstarRef,
    (newEl) => {
      if (newEl) {
        void startViewer()
      } else {
        void teardownViewer()
      }
    },
    { immediate: true }
  )

  // Re-highlight when variants change
  watch(variants, () => {
    if (structureLoaded.value) {
      void highlightVariants()
    }
  })

  // Re-highlight when ClinVar variants change
  if (clinvarVariants) {
    watch(clinvarVariants, () => {
      if (structureLoaded.value) {
        void highlightVariants()
      }
    })
  }

  onBeforeUnmount(() => {
    void teardownViewer()
  })

  return {
    loading,
    error,
    structureLoaded,
    activeRepresentation,
    variantStyle,
    focusResidue,
    setRepresentation,
    setVariantStyle,
    resetView
  }
}
