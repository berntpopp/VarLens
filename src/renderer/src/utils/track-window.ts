/**
 * The shared model of the lollipop and gene-structure views: a visible
 * window over one coordinate axis (amino acids or base pairs), the markers
 * drawn on it and the features (domains, exons) under it. Pure functions;
 * both renderers and the navigator read them.
 */
import type { ClinVarSignificance } from '../../../shared/types/protein'
import { CLINVAR_CLASS_LABELS } from '../config/proteinPlotConfig'

export interface TrackWindow {
  start: number
  end: number
}

export type TrackKind = 'variant' | 'cohort' | 'clinvar' | 'gnomad'

/** One plotted variant (or, zoomed out, one bin of them). */
export interface TrackMarker {
  key: string
  /** Position on the view's axis (aa or bp) */
  position: number
  track: TrackKind
  label: string
  /** Carriers (cohort) or variants it stands for; marker size follows it */
  weight: number
  color: string
  /** The variant of interest: own shape and label, always drawn, never binned */
  isAnchor?: boolean
  /** Set on a bin: the keys of the markers it stands for */
  binnedKeys?: string[]
  aaChange?: string | null
  cdna?: string | null
  chr?: string | null
  pos?: number | null
  proteinPosition?: number | null
  clinvarClass?: ClinVarSignificance | null
  stars?: number | null
  carriers?: number | null
  consequence?: string | null
  /** gnomAD allele frequency (its track's height) */
  af?: number | null
}

/** A domain (protein) or an exon (gene structure). */
export interface TrackFeature {
  key: string
  name: string
  start: number
  end: number
  color?: string
}

const span = (w: TrackWindow): number => w.end - w.start

/** Worst first (the config's order). */
const CLASS_RANK = Object.keys(CLINVAR_CLASS_LABELS) as ClinVarSignificance[]
const rank = (m: TrackMarker): number =>
  m.clinvarClass ? CLASS_RANK.indexOf(m.clinvarClass) : CLASS_RANK.length

/** The marker whose ClinVar class is worst (Pathogenic before Benign); the first on a tie. */
export const worstClinvar = (markers: TrackMarker[]): TrackMarker =>
  markers.reduce((worst, m) => (rank(m) < rank(worst) ? m : worst))

/** Keep a window inside the extent and at least `minSpan` wide. */
export function clampWindow(w: TrackWindow, extent: TrackWindow, minSpan: number): TrackWindow {
  const full = span(extent)
  const width = Math.min(full, Math.max(minSpan, span(w)))
  if (width >= full) return { ...extent }
  const centre = (w.start + w.end) / 2
  let start = span(w) < minSpan ? centre - width / 2 : w.start
  start = Math.min(Math.max(start, extent.start), extent.end - width)
  return { start, end: start + width }
}

/** Zoom by `factor` (> 1 in) around `centre`, which stays where it is on screen. */
export function zoomWindow(
  w: TrackWindow,
  factor: number,
  centre: number,
  extent: TrackWindow,
  minSpan: number
): TrackWindow {
  const width = span(w) / factor
  const f = (centre - w.start) / span(w)
  return clampWindow(
    { start: centre - f * width, end: centre - f * width + width },
    extent,
    minSpan
  )
}

/** Pan by a fraction of the window width (negative = left). */
export function panWindow(w: TrackWindow, fraction: number, extent: TrackWindow): TrackWindow {
  const dx = span(w) * fraction
  return clampWindow({ start: w.start + dx, end: w.end + dx }, extent, 0)
}

export function windowAround(
  centre: number,
  half: number,
  extent: TrackWindow,
  minSpan: number
): TrackWindow {
  return clampWindow({ start: centre - half, end: centre + half }, extent, minSpan)
}

/** A feature with a 10 % margin on each side. */
export function windowForFeature(
  f: { start: number; end: number },
  extent: TrackWindow,
  minSpan: number
): TrackWindow {
  const pad = (f.end - f.start) * 0.1
  return clampWindow({ start: f.start - pad, end: f.end + pad }, extent, minSpan)
}

/**
 * The markers to draw for this window: all of them while few are in view,
 * else one marker per track and screen bin (`binPx` wide), whose weight is the
 * sum of what it stands for. The variant of interest is never binned.
 */
export function binMarkers(
  markers: TrackMarker[],
  w: TrackWindow,
  plotWidthPx: number,
  opts: { maxUnbinned: number; binPx: number }
): TrackMarker[] {
  const inView = markers.filter((m) => m.position >= w.start && m.position <= w.end)
  if (inView.length <= opts.maxUnbinned || plotWidthPx <= 0) return inView
  const binWidth = (span(w) * opts.binPx) / plotWidthPx
  const bins = new Map<string, TrackMarker>()
  const first = new Map<string, TrackMarker>()
  const kept: TrackMarker[] = []
  for (const m of inView) {
    if (m.isAnchor === true) {
      kept.push(m)
      continue
    }
    const index = Math.floor((m.position - w.start) / binWidth)
    const id = `${m.track}:${index}`
    const bin = bins.get(id)
    if (bin === undefined) {
      first.set(id, m)
      bins.set(id, {
        key: `bin-${id}`,
        position: w.start + (index + 0.5) * binWidth,
        track: m.track,
        label: m.label,
        weight: m.weight,
        color: m.color,
        clinvarClass: m.clinvarClass,
        binnedKeys: [m.key]
      })
    } else {
      bin.weight += m.weight
      bin.binnedKeys!.push(m.key)
      if (rank(m) < rank(bin)) {
        bin.clinvarClass = m.clinvarClass
        bin.color = m.color
      }
      bin.label = `${bin.binnedKeys!.length} variants`
    }
  }
  // A bin of one is just that marker.
  const out = [...bins.entries()].map(([id, b]) =>
    b.binnedKeys!.length === 1 ? first.get(id)! : b
  )
  return [...out, ...kept]
}
