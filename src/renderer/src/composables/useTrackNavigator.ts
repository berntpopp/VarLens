/**
 * Navigation state shared by the lollipop and gene-structure views: the
 * visible window, the variant of interest (anchor) and its neighbourhood,
 * search highlights, the focused marker and the plot's keyboard.
 */
import { computed, ref, shallowRef, watch, type Ref } from 'vue'
import {
  MIN_WINDOW,
  NEIGHBOURHOOD_HALF_WIDTHS,
  PAN_FRACTION,
  ZOOM_STEP
} from '../config/proteinPlotConfig'
import { hasCommandModifier } from './useTableKeyboardNav'
import type { TrackMatch } from '../utils/track-search'
import { neighbourhoodSummary } from '../utils/track-neighbourhood'
import {
  clampWindow,
  panWindow,
  windowAround,
  windowForFeature,
  zoomWindow,
  type TrackFeature,
  type TrackMarker,
  type TrackWindow
} from '../utils/track-window'

export function useTrackNavigator(opts: {
  view: 'protein' | 'gene'
  extent: Ref<TrackWindow>
  markers: Ref<TrackMarker[]>
  features: Ref<TrackFeature[]>
}) {
  const { view, extent, markers, features } = opts
  const minSpan = MIN_WINDOW[view]
  const halfWidths = NEIGHBOURHOOD_HALF_WIDTHS[view]
  const half = ref<number>(halfWidths[0])
  const window = shallowRef<TrackWindow>({ ...extent.value })
  const highlighted = shallowRef<Set<string>>(new Set())
  const focusedKey = ref<string | null>(null)
  const anchorOverride = ref<string | null>(null)

  const originalAnchor = computed(() => markers.value.find((m) => m.isAnchor === true) ?? null)
  const anchor = computed(
    () => markers.value.find((m) => m.key === anchorOverride.value) ?? originalAnchor.value
  )
  /** Markers with `isAnchor` following the (possibly changed) variant of interest. */
  const displayMarkers = computed(() =>
    markers.value.map((m) =>
      (m.key === anchor.value?.key) === (m.isAnchor === true)
        ? m
        : { ...m, isAnchor: m.key === anchor.value?.key }
    )
  )
  const neighbourhood = computed(() =>
    anchor.value === null
      ? null
      : neighbourhoodSummary({
          anchor: anchor.value.position,
          half: half.value,
          features: features.value,
          markers: displayMarkers.value
        })
  )

  const setWindow = (w: TrackWindow): void => {
    window.value = clampWindow(w, extent.value, minSpan)
  }
  const reset = (): void => setWindow(extent.value)
  function frameAnchor(): void {
    if (anchor.value === null) reset()
    else setWindow(windowAround(anchor.value.position, half.value, extent.value, minSpan))
  }
  // A new gene / protein or a new variant of interest: show its neighbourhood.
  watch(
    () => [extent.value.start, extent.value.end, originalAnchor.value?.key],
    () => {
      anchorOverride.value = null
      frameAnchor()
    },
    { immediate: true }
  )

  const centre = (): number => (window.value.start + window.value.end) / 2
  const zoom = (factor: number, at = centre()): void =>
    setWindow(zoomWindow(window.value, factor, at, extent.value, minSpan))
  const pan = (fraction: number): void => setWindow(panWindow(window.value, fraction, extent.value))

  function goTo(match: TrackMatch): void {
    const t = match.target
    setWindow(
      typeof t === 'number'
        ? windowAround(t, half.value, extent.value, minSpan)
        : windowForFeature(t, extent.value, minSpan)
    )
    highlighted.value = new Set(match.markerKeys)
    focusedKey.value = match.markerKeys[0] ?? null
  }

  function setAnchor(key: string): void {
    anchorOverride.value = key
    frameAnchor()
  }
  function resetAnchor(): void {
    anchorOverride.value = null
    frameAnchor()
  }
  function setHalfWidth(value: number): void {
    half.value = value
    frameAnchor()
  }
  const highlight = (keys: string[]): void => {
    highlighted.value = new Set(keys)
  }

  /** Move the focus to the next / previous variant (gnomAD excluded) and keep it in view. */
  function stepFocus(direction: 1 | -1): string | null {
    const order = displayMarkers.value
      .filter((m) => m.track !== 'gnomad')
      .sort((a, b) => a.position - b.position)
    const at = order.findIndex((m) => m.key === focusedKey.value)
    const next = order[Math.min(order.length - 1, Math.max(0, at + direction))] ?? null
    focusedKey.value = next?.key ?? null
    if (next !== null && (next.position < window.value.start || next.position > window.value.end)) {
      const width = window.value.end - window.value.start
      setWindow({ start: next.position - width / 2, end: next.position + width / 2 })
    }
    return focusedKey.value
  }

  /** The plot container's keys (markers handle their own ←/→ and Esc). */
  function onKeydown(e: KeyboardEvent): void {
    if (hasCommandModifier(e)) return
    const actions: Record<string, () => void> = {
      '+': () => zoom(ZOOM_STEP),
      '=': () => zoom(ZOOM_STEP),
      '-': () => zoom(1 / ZOOM_STEP),
      ArrowLeft: () => pan(-PAN_FRACTION),
      ArrowRight: () => pan(PAN_FRACTION),
      Home: reset
    }
    const action = actions[e.key]
    if (action === undefined) return
    e.preventDefault()
    action()
  }

  return {
    window,
    setWindow,
    zoom,
    pan,
    reset,
    goTo,
    highlight,
    highlighted,
    focusedKey,
    stepFocus,
    anchor,
    originalAnchor,
    setAnchor,
    resetAnchor,
    frameAnchor,
    half,
    halfWidths,
    setHalfWidth,
    displayMarkers,
    neighbourhood,
    onKeydown
  }
}

export type TrackNavigator = ReturnType<typeof useTrackNavigator>
