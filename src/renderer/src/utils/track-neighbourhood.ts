/**
 * The variant of interest in context: where it lies (domain / exon or
 * between them) and which variants are within ± a half-width of it.
 */
import type { ClinVarSignificance } from '../../../shared/types/protein'
import { CLINVAR_CLASS_LABELS } from '../config/proteinPlotConfig'
import type { TrackFeature, TrackMarker, TrackWindow } from './track-window'

/** Worst first, the order the summary lists them in. */
const CLASS_ORDER = Object.keys(CLINVAR_CLASS_LABELS) as ClinVarSignificance[]

export interface Neighbourhood {
  window: TrackWindow
  /** The domain / exon that contains the anchor */
  feature: TrackFeature | null
  /** A CNV/SV: the features its interval overlaps, left to right (null for a point) */
  spans: TrackFeature[] | null
  /** A CNV/SV that reaches past the gene / protein */
  beyondExtent: boolean
  /** Outside every feature: the nearest one on each side */
  before: TrackFeature | null
  after: TrackFeature | null
  /** To the nearest edge of the containing feature, or to the nearest feature */
  boundaryDistance: number | null
  nearestName: string | null
  clinvar: Array<{ cls: ClinVarSignificance; label: string; keys: string[] }>
  cohort: { variants: number; carriers: number; keys: string[] }
  /** Everything else in the window (not gnomAD), closest first; distance is signed */
  nearby: Array<{ marker: TrackMarker; distance: number }>
}

export function neighbourhoodSummary(input: {
  anchor: number
  /** A CNV/SV interval's end */
  anchorEnd?: number
  half: number
  features: TrackFeature[]
  markers: TrackMarker[]
  extent?: TrackWindow
}): Neighbourhood {
  const { anchor, half, features } = input
  const end = input.anchorEnd ?? anchor
  const window = { start: anchor - half, end: end + half }
  const spans =
    input.anchorEnd === undefined
      ? null
      : features.filter((f) => f.start <= end && f.end >= anchor).sort((a, b) => a.start - b.start)
  const beyondExtent =
    input.extent !== undefined && (anchor < input.extent.start || end > input.extent.end)
  const feature =
    spans === null ? (features.find((f) => f.start <= anchor && anchor <= f.end) ?? null) : null
  const before = feature
    ? null
    : last(
        features.filter((f) => f.end < anchor),
        (f) => f.end
      )
  const after = feature
    ? null
    : last(
        features.filter((f) => f.start > anchor),
        (f) => -f.start
      )
  const toBefore = before ? anchor - before.end : Infinity
  const toAfter = after ? after.start - anchor : Infinity
  const boundaryDistance = feature
    ? Math.min(anchor - feature.start, feature.end - anchor)
    : Number.isFinite(Math.min(toBefore, toAfter))
      ? Math.min(toBefore, toAfter)
      : null
  const nearestName = feature?.name ?? (toAfter < toBefore ? after?.name : before?.name) ?? null

  const inWindow = input.markers.filter(
    (m) =>
      m.isAnchor !== true &&
      m.track !== 'gnomad' &&
      m.position >= window.start &&
      m.position <= window.end
  )
  const clinvar = CLASS_ORDER.map((cls) => ({
    cls,
    label: CLINVAR_CLASS_LABELS[cls],
    keys: inWindow.filter((m) => m.track === 'clinvar' && m.clinvarClass === cls).map((m) => m.key)
  })).filter((g) => g.keys.length > 0)
  const cohortMarkers = inWindow.filter((m) => m.track === 'cohort')
  // Inside a CNV/SV interval the distance is 0; outside it, to its nearer edge.
  const distanceTo = (p: number): number => (p < anchor ? p - anchor : p > end ? p - end : 0)
  const nearby = inWindow
    .map((marker) => ({ marker, distance: distanceTo(marker.position) }))
    .sort((a, b) => Math.abs(a.distance) - Math.abs(b.distance) || a.distance - b.distance)

  return {
    window,
    feature,
    spans,
    beyondExtent,
    before,
    after,
    boundaryDistance,
    nearestName,
    clinvar,
    cohort: {
      variants: cohortMarkers.length,
      carriers: cohortMarkers.reduce((sum, m) => sum + m.weight, 0),
      keys: cohortMarkers.map((m) => m.key)
    },
    nearby
  }
}

/** The element with the largest score, or null. */
function last<T>(items: T[], score: (t: T) => number): T | null {
  return items.reduce<T | null>(
    (best, t) => (best === null || score(t) > score(best) ? t : best),
    null
  )
}

/** "±25 aa", "±500 bp", "±2 kb" */
export function formatHalfWidth(half: number, unit: string): string {
  return unit === 'bp' && half >= 1000 ? `±${half / 1000} kb` : `±${half} ${unit}`
}

/** "±25 aa: 2 Pathogenic, 1 VUS · 2 cohort variants, 9 carriers" */
export function neighbourhoodLine(n: Neighbourhood, half: number, unit: string): string {
  const parts = n.clinvar.map((g) => `${g.keys.length} ${g.label}`).join(', ')
  const cohort =
    n.cohort.variants > 0
      ? `${n.cohort.variants} cohort variant${n.cohort.variants === 1 ? '' : 's'}, ${n.cohort.carriers} carrier${n.cohort.carriers === 1 ? '' : 's'}`
      : ''
  const body = [parts, cohort].filter((p) => p !== '').join(' · ')
  return `${formatHalfWidth(half, unit)}: ${body === '' ? 'no other variants' : body}`
}

/** "In THO domain · 30 aa to its edge" / "Between domains · 70 aa to Coiled coil" */
export function locationLine(
  n: Neighbourhood,
  unit: string,
  betweenLabel: string,
  noFeaturesLabel = betweenLabel,
  outsideLabel = ''
): string {
  const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)
  if (n.spans !== null) {
    const [first, last] = [n.spans[0], n.spans[n.spans.length - 1]]
    const where =
      n.spans.length === 0
        ? capital(betweenLabel)
        : n.spans.length === 1
          ? `Overlaps ${first.name}`
          : `Spans ${first.name} – ${last.name} (${n.spans.length})`
    return n.beyondExtent && outsideLabel !== '' ? `${where} · reaches ${outsideLabel}` : where
  }
  if (n.feature) return `In ${n.feature.name} · ${n.boundaryDistance} ${unit} to its edge`
  if (n.before === null && n.after === null) return capital(noFeaturesLabel)
  const lead = capital(betweenLabel)
  return n.nearestName === null
    ? lead
    : `${lead} · ${n.boundaryDistance} ${unit} to ${n.nearestName}`
}
