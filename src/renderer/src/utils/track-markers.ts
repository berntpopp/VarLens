/**
 * Builds the markers and features of the lollipop (amino acids) and
 * gene-structure (base pairs) views from the rows the modal already has.
 * Rows without a position on the view's axis are left out.
 */
import type {
  ClinVarVariant,
  GeneExon,
  GnomadVariant,
  LollipopVariant,
  ProteinDomain
} from '../../../shared/types/protein'
import {
  CLINVAR_COLORS,
  getClinVarCategory,
  getConsequenceColor,
  getDomainColor
} from '../../../shared/utils/protein-utils'
import type { TrackFeature, TrackMarker } from './track-window'

/** The variant shown in the gene structure: a point, or a CNV/SV interval. */
export interface GenomicVariant {
  chr: string
  pos: number
  /** Interval end for CNV/SV calls; absent or null renders a point. */
  end?: number | null
  ref: string
  alt: string
  label: string
  color: string
}

export function isInterval(v: GenomicVariant): v is GenomicVariant & { end: number } {
  return v.end !== null && v.end !== undefined && v.end > v.pos
}

export interface TrackData {
  markers: TrackMarker[]
  features: TrackFeature[]
}

/** "ENSP…:p.Met180Val" → "p.Met180Val" (the transcript prefix is noise on a plot). */
export const shortHgvs = (hgvs: string): string =>
  hgvs.replace(/^[^:\s]+:(?=[pc]\.)/, '').replace(/%3D/gi, '=')

function variantMarker(v: LollipopVariant, position: number): TrackMarker {
  return {
    key: `v:${v.chr}:${v.pos}:${v.ref}:${v.alt}`,
    position,
    track: v.carrierCount === undefined ? 'variant' : 'cohort',
    label: v.aaChange === null ? `${v.chr}:${v.pos}` : shortHgvs(v.aaChange),
    weight: v.carrierCount ?? 1,
    color: v.color,
    isAnchor: v.highlighted === true,
    aaChange: v.aaChange,
    cdna: v.cdna ?? null,
    chr: v.chr,
    pos: v.pos,
    proteinPosition: v.proteinPosition,
    carriers: v.carrierCount ?? null,
    consequence: v.consequence
  }
}

function clinvarMarker(cv: ClinVarVariant, position: number): TrackMarker {
  const cls = getClinVarCategory(cv.clinicalSignificance)
  const [chr, pos] = cv.variantId.split('-')
  return {
    key: `cv:${cv.variantId}`,
    position,
    track: 'clinvar',
    label: cv.hgvsp === null ? cv.variantId : shortHgvs(cv.hgvsp),
    weight: 1,
    color: CLINVAR_COLORS[cls],
    aaChange: cv.hgvsp,
    chr: chr ?? null,
    pos: cv.genomicPosition ?? (Number(pos) || null),
    proteinPosition: cv.proteinPosition,
    clinvarClass: cls,
    stars: cv.goldStars,
    consequence: cv.consequence
  }
}

export function proteinTrackData(input: {
  variants: LollipopVariant[]
  clinvar: ClinVarVariant[]
  gnomad: GnomadVariant[]
  domains: ProteinDomain[]
}): TrackData {
  const markers: TrackMarker[] = input.variants.map((v) => variantMarker(v, v.proteinPosition))
  for (const cv of input.clinvar) {
    if (cv.proteinPosition !== null) markers.push(clinvarMarker(cv, cv.proteinPosition))
  }
  for (const g of input.gnomad) {
    if (g.proteinPosition === null) continue
    markers.push({
      key: `gn:${g.variantId}`,
      position: g.proteinPosition,
      track: 'gnomad',
      label: g.hgvsp === null ? g.variantId : shortHgvs(g.hgvsp),
      weight: 1,
      color: getConsequenceColor(g.consequence),
      aaChange: g.hgvsp,
      proteinPosition: g.proteinPosition,
      consequence: g.consequence,
      af: g.alleleFrequency
    })
  }
  const features = input.domains.map((d) => ({
    key: `${d.accession}-${d.start}`,
    name: d.name,
    start: d.start,
    end: d.end,
    color: getDomainColor(d.type)
  }))
  return { markers, features }
}

export function geneTrackData(input: {
  variants: LollipopVariant[]
  clinvar: ClinVarVariant[]
  exons: GeneExon[]
  anchor: GenomicVariant | null
}): TrackData {
  const markers: TrackMarker[] = []
  const a = input.anchor
  if (a !== null) {
    markers.push({
      key: `anchor:${a.chr}:${a.pos}:${a.ref}:${a.alt}`,
      position: a.pos,
      track: 'variant',
      label: shortHgvs(a.label),
      weight: 1,
      color: a.color,
      isAnchor: true,
      chr: a.chr,
      pos: a.pos
    })
  }
  // The highlighted row is the anchor itself.
  for (const v of input.variants) {
    if (!(a !== null && v.highlighted === true))
      markers.push({ ...variantMarker(v, v.pos), isAnchor: false })
  }
  for (const cv of input.clinvar) {
    if (cv.genomicPosition !== null) markers.push(clinvarMarker(cv, cv.genomicPosition))
  }
  const features = input.exons.map((e) => ({
    key: `exon-${e.rank}`,
    name: `Exon ${e.rank}`,
    start: e.start,
    end: e.end
  }))
  return { markers, features }
}
