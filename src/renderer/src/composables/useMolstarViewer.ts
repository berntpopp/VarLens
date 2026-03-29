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

/** Lazy-load the pdbe-molstar web component script on first use */
let molstarScriptLoaded = false
let molstarScriptLoadPromise: Promise<void> | null = null
function ensureMolstarScript(): Promise<void> {
  if (molstarScriptLoaded) return Promise.resolve()
  // Return the in-flight promise if a load is already pending
  if (molstarScriptLoadPromise) return molstarScriptLoadPromise

  molstarScriptLoadPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = '/pdbe-molstar-component.js'
    script.onload = () => {
      logService.info('pdbe-molstar script loaded on demand', 'MolstarViewer')
      molstarScriptLoaded = true
      molstarScriptLoadPromise = null
      resolve()
    }
    script.onerror = () => {
      molstarScriptLoadPromise = null // Allow retry on next call
      script.remove() // Remove failed element to avoid duplicates on retry
      reject(new Error('Failed to load pdbe-molstar script'))
    }
    document.head.appendChild(script)
  })

  return molstarScriptLoadPromise
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

/** pdbe-molstar viewer instance (partial typing for the API we use) */
interface MolstarViewerInstance {
  events: {
    loadComplete: {
      subscribe: (callback: (success: boolean) => void) => { unsubscribe: () => void }
    }
  }
  visual: {
    select: (params: { data: SelectionDataItem[]; nonSelectedColor?: RgbColor }) => Promise<void>
    reset: (params: { camera: boolean; theme: boolean }) => void
    update: (options: Record<string, unknown>, fullLoad?: boolean) => void | Promise<void>
  }
  canvas: {
    setBgColor: (color: RgbColor) => void
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
  const variantStyle = ref<VariantStyle>('colored')

  // Store viewer instance outside Vue reactivity (WebGL objects break with proxies)
  let viewerInstance: MolstarViewerInstance | null = null
  let loadSubscription: { unsubscribe: () => void } | null = null
  let pollingTimer: ReturnType<typeof setInterval> | null = null

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
          setTimeout(() => void highlightVariants(), 500)
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
   * Wait for the pdbe-molstar custom element to be registered, then poll
   * for the viewerInstance to appear on the DOM element.
   *
   * Uses the standard `customElements.whenDefined()` API which returns a
   * Promise that resolves when the element is registered. This is superior
   * to polling because it reacts instantly to registration and handles
   * slow script loading gracefully (e.g. Windows antivirus scanning the
   * 6 MB pdbe-molstar script during ASAR extraction).
   *
   * After registration, a short poll waits for viewerInstance which is
   * set synchronously in connectedCallback but may be delayed by Vue's
   * DOM update batching.
   */
  function startPolling(): void {
    stopPolling()

    if (typeof customElements === 'undefined') {
      loading.value = false
      error.value = '3D viewer is not supported in this environment.'
      logService.error('customElements API is unavailable', 'MolstarViewer')
      return
    }

    // Phase 0: Ensure script is loaded (lazy — only on first 3D viewer open).
    // Phase 1: Wait for custom element registration (with timeout).
    // Phase 2: Poll for viewerInstance on the DOM element.
    void ensureMolstarScript()
      .then(() => {
        // If already registered, skip whenDefined
        if (customElements.get('pdbe-molstar')) return

        // Wrap whenDefined in a timeout — if the script loads but fails to
        // call customElements.define(), we don't hang forever
        return new Promise<void>((resolve, reject) => {
          const timeoutMs = 30_000
          const timeoutId = setTimeout(() => {
            reject(new Error('Timed out waiting for pdbe-molstar custom element registration'))
          }, timeoutMs)

          void customElements
            .whenDefined('pdbe-molstar')
            .then(() => {
              clearTimeout(timeoutId)
              resolve()
            })
            .catch((err) => {
              clearTimeout(timeoutId)
              reject(err)
            })
        })
      })
      .then(() => {
        logService.info('pdbe-molstar custom element registered', 'MolstarViewer')

        // Phase 2: Poll for viewerInstance on the DOM element.
        // connectedCallback sets it synchronously, but Vue may not have
        // flushed the DOM update yet, so a brief poll is warranted.
        let viewerAttempts = 0
        const maxViewerAttempts = 60 // 30 seconds

        pollingTimer = setInterval(() => {
          viewerAttempts++
          if (tryAttachViewer()) {
            stopPolling()
            return
          }
          if (viewerAttempts >= maxViewerAttempts) {
            stopPolling()
            loading.value = false
            error.value = 'Timed out waiting for 3D viewer to initialize'
            logService.error(
              'pdbe-molstar viewer instance not found after timeout — ' +
                `element exists: ${!!molstarRef.value}, ` +
                `tagName: ${molstarRef.value?.tagName ?? 'null'}, ` +
                `has viewerInstance: ${!!(molstarRef.value as PdbeMolstarElement | null)?.viewerInstance}`,
              'MolstarViewer'
            )
          }
        }, 500)
      })
      .catch((err: Error) => {
        loading.value = false
        error.value = '3D viewer component failed to load. Try restarting the application.'
        logService.error(`pdbe-molstar init failed: ${err.message}`, 'MolstarViewer')
      })
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
      logService.error(
        `Failed to highlight variants: ${err instanceof Error ? err.message : String(err)}`,
        'MolstarViewer'
      )
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
      logService.error(
        `Failed to focus residue ${position}: ${err instanceof Error ? err.message : String(err)}`,
        'MolstarViewer'
      )
    }
  }

  /**
   * Switch the molecular representation type.
   *
   * Updates the activeRepresentation ref which triggers the MolstarViewer
   * component to recreate the <pdbe-molstar> element with a new :key.
   * This avoids the pdbe-molstar fullLoad bug where visual.update(opts, true)
   * resets the WebGL background to black and setBgColor cannot restore it.
   * A fresh element initialized with bg-color-r/g/b attributes always renders
   * with the correct background.
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
    variantStyle,
    focusResidue,
    setRepresentation,
    setVariantStyle,
    resetView
  }
}
