/**
 * The interactive frame both track plots share: it redraws the view for the
 * navigator's window (once per animation frame), turns wheel and drag into
 * zoom and pan, makes markers focusable with a live tooltip, and exports.
 * Each view supplies only its `draw`.
 */
import * as d3 from 'd3'
import { onBeforeUnmount, ref, watch, type Ref } from 'vue'
import {
  BIN_PX,
  MAX_MARKERS_UNBINNED,
  TRACK_GUTTER_PX,
  ZOOM_STEP
} from '../../config/proteinPlotConfig'
import type { TrackNavigator } from '../useTrackNavigator'
import type { Dimensions } from '../useResizeObserver'
import { svgMarkup, svgToPng } from '../../utils/svg-export'
import {
  binMarkers,
  type TrackFeature,
  type TrackMarker,
  type TrackWindow
} from '../../utils/track-window'

export const PLOT_RIGHT_PX = 16

export interface TrackTooltipData {
  visible: boolean
  x: number
  y: number
  marker?: TrackMarker
  feature?: TrackFeature
}

type Root = d3.Selection<SVGSVGElement, unknown, null, undefined>

export interface TrackDrawContext {
  root: Root
  width: number
  height: number
  plotWidth: number
  /** Window → [0, plotWidth] inside the plot group (translated by the gutter) */
  x: d3.ScaleLinear<number, number>
  window: TrackWindow
  /** Markers in view, binned when zoomed out */
  markers: TrackMarker[]
  highlighted: Set<string>
  focusedKey: string | null
  /** Wire a drawn marker for hover, focus, click and the keyboard */
  bindMarker: (el: d3.Selection<SVGGElement, unknown, null, undefined>, m: TrackMarker) => void
  /** Wire a drawn feature for hover and click-to-zoom */
  bindFeature: (el: d3.Selection<SVGElement, unknown, null, undefined>, f: TrackFeature) => void
}

export function markerAriaLabel(m: TrackMarker, unit: string): string {
  const parts = [m.label, `${unit === 'aa' ? 'p.' : 'position '}${Math.round(m.position)}`]
  if (m.binnedKeys !== undefined) parts.push(`${m.binnedKeys.length} variants, zoom in to separate`)
  if (m.carriers !== null && m.carriers !== undefined) parts.push(`${m.carriers} carriers`)
  if (m.clinvarClass) parts.push(`ClinVar ${m.clinvarClass.replace('_', ' ')}`)
  if (m.isAnchor === true) parts.push('variant of interest')
  return parts.join(' · ')
}

export function useTrackPlot(opts: {
  svgRef: Ref<SVGSVGElement | null>
  dimensions: Ref<Dimensions>
  nav: TrackNavigator
  unit: 'aa' | 'bp'
  /** Extra reactive inputs of the view (features, toggles) */
  deps: () => unknown
  draw: (ctx: TrackDrawContext) => void
}) {
  const { svgRef, dimensions, nav } = opts
  const tooltip = ref<TrackTooltipData>({ visible: false, x: 0, y: 0 })
  let frame = 0
  let refocus = false
  let pin = false
  /** Drawn markers (not gnomAD) left to right, and the element of each key (bins: every key in them). */
  let rendered: TrackMarker[] = []
  const elementOf = new Map<string, SVGGElement>()

  const plotWidth = (): number => dimensions.value.width - TRACK_GUTTER_PX - PLOT_RIGHT_PX
  const scale = (): d3.ScaleLinear<number, number> =>
    d3.scaleLinear().domain([nav.window.value.start, nav.window.value.end]).range([0, plotWidth()])

  const show = (event: MouseEvent | null, data: Partial<TrackTooltipData>): void => {
    tooltip.value =
      event === null
        ? { ...tooltip.value, visible: false }
        : { visible: true, x: event.clientX, y: event.clientY, ...data }
  }

  function bindMarker(
    el: d3.Selection<SVGGElement, unknown, null, undefined>,
    m: TrackMarker
  ): void {
    el.attr('data-key', m.key)
      .classed(`track-marker track-${m.track}`, true)
      .attr('cursor', 'pointer')
      .on('mouseenter mousemove', (e: MouseEvent) => show(e, { marker: m, feature: undefined }))
      .on('mouseleave', () => show(null, {}))
      .on('click', () => {
        nav.focusedKey.value = m.key
        ;(el.node() as SVGGElement | null)?.focus()
      })
    if (m.track === 'gnomad') return
    for (const key of [m.key, ...(m.binnedKeys ?? [])]) elementOf.set(key, el.node() as SVGGElement)
    rendered.push(m)
    el.attr('tabindex', 0)
      .attr('role', 'button')
      .attr('aria-label', markerAriaLabel(m, opts.unit))
      .on('focus', () => {
        nav.focusedKey.value = m.key
        const box = (el.node() as SVGGElement).getBoundingClientRect()
        tooltip.value = { visible: true, x: box.right, y: box.top, marker: m }
      })
      .on('blur', () => show(null, {}))
      .on('keydown', (e: KeyboardEvent) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault()
          e.stopPropagation()
          stepFocus(e.key === 'ArrowRight' ? 1 : -1)
        } else if (e.key === 'Enter' && m.binnedKeys === undefined) {
          e.preventDefault()
          nav.setAnchor(m.key)
        } else if (e.key === 'Escape') {
          e.stopPropagation()
          ;(svgRef.value?.parentElement as HTMLElement | null)?.focus()
        }
      })
  }

  /** ← / → on a marker: the next drawn one; past the last in view, pan to the next variant. */
  function stepFocus(direction: 1 | -1): void {
    const order = [...rendered].sort((a, b) => a.position - b.position)
    const key = nav.focusedKey.value
    const at = order.findIndex((m) => m.key === key || m.binnedKeys?.includes(key ?? '') === true)
    const next = at === -1 ? undefined : order[at + direction]
    if (next !== undefined) nav.focusedKey.value = next.key
    else nav.stepFocus(direction)
    refocus = true
    schedule()
  }

  function bindFeature(
    el: d3.Selection<SVGElement, unknown, null, undefined>,
    f: TrackFeature
  ): void {
    el.attr('cursor', 'zoom-in')
      .on('mouseenter mousemove', (e: MouseEvent) => show(e, { feature: f, marker: undefined }))
      .on('mouseleave', () => show(null, {}))
      .on('click', () =>
        nav.goTo({ key: f.key, label: f.name, detail: '', target: f, markerKeys: [] })
      )
  }

  function render(): void {
    frame = 0
    const svg = svgRef.value
    const { width, height } = dimensions.value
    if (svg === null || width <= 0 || height <= 0 || plotWidth() <= 0) return
    // Redrawing replaces the markers: keep the keyboard focus on the focused one.
    refocus = refocus || svg.contains(document.activeElement)
    const root = d3.select(svg) as Root
    root.selectAll('*').remove()
    rendered = []
    elementOf.clear()
    root.attr('width', width).attr('height', height)
    const markers = binMarkers(nav.displayMarkers.value, nav.window.value, plotWidth(), {
      maxUnbinned: MAX_MARKERS_UNBINNED,
      binPx: BIN_PX
    })
    opts.draw({
      root,
      width,
      height,
      plotWidth: plotWidth(),
      x: scale(),
      window: nav.window.value,
      markers,
      highlighted: nav.highlighted.value,
      focusedKey: nav.focusedKey.value,
      bindMarker,
      bindFeature
    })
    const focusedEl = elementOf.get(nav.focusedKey.value ?? '') ?? null
    if (refocus) focusedEl?.focus()
    else if (pin && focusedEl !== null) {
      // A search hit or list row: pin its tooltip without moving the keyboard focus.
      const box = focusedEl.getBoundingClientRect()
      const marker = rendered.find(
        (m) =>
          m.key === nav.focusedKey.value ||
          m.binnedKeys?.includes(nav.focusedKey.value ?? '') === true
      )
      if (marker !== undefined) tooltip.value = { visible: true, x: box.right, y: box.top, marker }
    }
    refocus = false
    pin = false
  }
  watch(nav.focusedKey, () => {
    pin = true
  })
  const schedule = (): void => {
    if (frame === 0) frame = requestAnimationFrame(render)
  }
  watch(
    () => [
      svgRef.value,
      dimensions.value,
      nav.window.value,
      nav.displayMarkers.value,
      nav.highlighted.value,
      nav.focusedKey.value,
      opts.deps()
    ],
    schedule,
    { immediate: true }
  )

  // Wheel = zoom around the pointer; drag on the background = pan.
  let drag: { x: number; window: TrackWindow; moved: boolean } | null = null
  const positionAt = (clientX: number): number => {
    const left = svgRef.value?.getBoundingClientRect().left ?? 0
    return scale().invert(clientX - left - TRACK_GUTTER_PX)
  }
  function onWheel(e: WheelEvent): void {
    e.preventDefault()
    const step = Math.sqrt(ZOOM_STEP)
    nav.zoom(e.deltaY < 0 ? step : 1 / step, positionAt(e.clientX))
  }
  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0 || (e.target as Element).closest('[data-key]') !== null) return
    drag = { x: e.clientX, window: nav.window.value, moved: false }
  }
  function onPointerMove(e: PointerEvent): void {
    if (drag === null) return
    const dx = e.clientX - drag.x
    if (!drag.moved && Math.abs(dx) < 3) return
    if (!drag.moved) svgRef.value?.setPointerCapture(e.pointerId)
    drag.moved = true
    const shift = (dx * (drag.window.end - drag.window.start)) / plotWidth()
    nav.setWindow({ start: drag.window.start - shift, end: drag.window.end - shift })
  }
  const onPointerUp = (): void => {
    drag = null
  }
  watch(
    svgRef,
    (svg, old) => {
      old?.removeEventListener('wheel', onWheel)
      if (svg === null) return
      svg.addEventListener('wheel', onWheel, { passive: false })
      svg.addEventListener('pointerdown', onPointerDown)
      svg.addEventListener('pointermove', onPointerMove)
      svg.addEventListener('pointerup', onPointerUp)
      svg.addEventListener('pointercancel', onPointerUp)
    },
    { immediate: true }
  )
  onBeforeUnmount(() => cancelAnimationFrame(frame))

  return {
    tooltip,
    exportSvg: (): string => svgMarkup(svgRef.value),
    exportPng: (): Promise<Blob | null> =>
      svgToPng(svgRef.value, dimensions.value.width, dimensions.value.height)
  }
}
