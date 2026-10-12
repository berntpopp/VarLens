/**
 * The search box of the lollipop and gene-structure views: one parser for
 * what the user typed, one matcher over the view's markers and features.
 * Accepted patterns and the amino-acid codes come from proteinPlotConfig.
 */
import { AA_THREE_TO_ONE, TRACK_SEARCH_PATTERNS as P } from '../config/proteinPlotConfig'
import type { TrackFeature, TrackMarker, TrackWindow } from './track-window'

export type TrackQuery =
  | { kind: 'position'; position: number }
  | { kind: 'aa-change'; change: string; position: number }
  | { kind: 'cdna'; cdna: string }
  | { kind: 'exon'; rank: number }
  | { kind: 'genomic'; chr: string; pos: number }
  | { kind: 'name'; text: string }

export interface TrackMatch {
  key: string
  label: string
  detail: string
  /** Where to go: a position (centred) or a range (framed) */
  target: number | TrackWindow
  markerKeys: string[]
}

export interface TrackSearchContext {
  view: 'protein' | 'gene'
  markers: TrackMarker[]
  features: TrackFeature[]
  /** Last position of the axis (protein length); positions past it find nothing */
  extentEnd?: number
}

const ONE_LETTER = new Set(Object.values(AA_THREE_TO_ONE))

/** "Met" / "met" / "M" / "*" / "=" → one-letter code, or null when it is no amino acid. */
function aaCode(token: string): string | null {
  if (token.length === 3) {
    return AA_THREE_TO_ONE[token[0].toUpperCase() + token.slice(1).toLowerCase()] ?? null
  }
  const one = token.toUpperCase()
  return ONE_LETTER.has(one) || one === '=' ? one : null
}

const normChr = (chr: string): string => chr.replace(/^chr/i, '').toUpperCase()

export function parseTrackQuery(input: string): TrackQuery | null {
  const q = input.trim()
  if (q === '') return null
  let m = P.proteinPosition.exec(q)
  if (m !== null) return { kind: 'position', position: Number(m[1]) }
  m = P.aaChange.exec(q)
  if (m !== null) {
    const [ref, alt] = [aaCode(m[1]), aaCode(m[3])]
    if (ref !== null && alt !== null) {
      return { kind: 'aa-change', change: `${ref}${m[2]}${alt}`, position: Number(m[2]) }
    }
  }
  if (P.cdna.test(q)) return { kind: 'cdna', cdna: q.toLowerCase() }
  m = P.exon.exec(q)
  if (m !== null) return { kind: 'exon', rank: Number(m[1]) }
  m = P.genomic.exec(q)
  if (m !== null)
    return { kind: 'genomic', chr: normChr(m[1]), pos: Number(m[2].replace(/,/g, '')) }
  return { kind: 'name', text: q.toLowerCase() }
}

/** "ENSP…:p.Met180Val", "p.(Arg42Ter)", "p.R248W" → "M180V", "R42*", "R248W". */
export function normaliseAaChange(hgvsp: string | null | undefined): string | null {
  if (hgvsp === null || hgvsp === undefined) return null
  const p = hgvsp.slice(hgvsp.lastIndexOf('p.') + 2).replace(/%3D/gi, '=')
  const m = /^\(?([A-Z][a-z]{2}|[A-Z*])(\d+)([A-Z][a-z]{2}|[A-Z*=])/.exec(p)
  if (m === null) return null
  const [ref, alt] = [aaCode(m[1]), aaCode(m[3])]
  return ref === null || alt === null ? null : `${ref}${m[2]}${alt}`
}

const countLabel = (n: number): string =>
  n === 0 ? 'no variant' : `${n} variant${n === 1 ? '' : 's'}`

function hit(key: string, label: string, target: number, found: TrackMarker[]): TrackMatch {
  return {
    key,
    label,
    detail: countLabel(found.length),
    target,
    markerKeys: found.map((m) => m.key)
  }
}

/** Matches for a parsed query, best first; [] when nothing fits this view. */
export function searchTrack(q: TrackQuery | null, ctx: TrackSearchContext): TrackMatch[] {
  if (q === null) return []
  const { markers, view } = ctx
  const protein = view === 'protein'
  const residue = (m: TrackMarker): number | null | undefined =>
    protein ? m.position : m.proteinPosition
  switch (q.kind) {
    case 'position':
    case 'aa-change': {
      if (protein && ctx.extentEnd !== undefined && q.position > ctx.extentEnd) return []
      const atResidue = markers.filter((m) => residue(m) === q.position)
      const found =
        q.kind === 'position'
          ? atResidue
          : atResidue.filter((m) => normaliseAaChange(m.aaChange) === q.change)
      const label = q.kind === 'position' ? `p.${q.position}` : `p.${q.change}`
      if (found.length === 0 && !protein) return []
      return [hit(`pos-${q.position}`, label, found[0]?.position ?? q.position, found)]
    }
    case 'cdna': {
      const found = markers.filter((m) => m.cdna?.toLowerCase().includes(q.cdna) === true)
      return found.length === 0 ? [] : [hit(`cdna-${q.cdna}`, q.cdna, found[0].position, found)]
    }
    case 'genomic': {
      const found = markers.filter(
        (m) =>
          m.pos === q.pos && (m.chr === null || m.chr === undefined || normChr(m.chr) === q.chr)
      )
      if (found.length === 0 && protein) return []
      const target = protein ? found[0].position : q.pos
      return [
        hit(`g-${q.chr}:${q.pos}`, `chr${q.chr}:${q.pos.toLocaleString('en-US')}`, target, found)
      ]
    }
    case 'exon':
      return featureMatches(ctx.features, (f) => f.name.toLowerCase() === `exon ${q.rank}`)
    case 'name':
      return featureMatches(ctx.features, (f) => f.name.toLowerCase().includes(q.text))
  }
}

function featureMatches(
  features: TrackFeature[],
  keep: (f: TrackFeature) => boolean
): TrackMatch[] {
  return features.filter(keep).map((f) => ({
    key: `feature-${f.key}`,
    label: f.name,
    detail: `${f.start}–${f.end}`,
    target: { start: f.start, end: f.end },
    markerKeys: []
  }))
}
