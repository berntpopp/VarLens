/**
 * The gene-structure view drawn by useTrackPlot: exons on the intron line
 * (strand chevrons, exon numbers that never collide), variants as lollipops
 * above, the variant of interest (a star, or a band for a CNV/SV), ClinVar
 * below, labelled in the left gutter, and the genomic axis (#571).
 */
import type { GeneStructure } from '../../../../shared/types/protein'
import { TRACK_LABELS } from '../../config/proteinPlotConfig'
import { genomicTickLabels, placeLabels } from '../../utils/track-layout'
import { isInterval, type GenomicVariant } from '../../utils/track-markers'
import { exonsInInterval, geneAxisLabel } from '../../utils/variant-interval'
import {
  anchorMarker,
  axis,
  diamondTrack,
  gutterLabel,
  lollipopTrack,
  plotGroup,
  TRACK_STYLE
} from './track-draw'
import type { TrackDrawContext } from './useTrackPlot'

export interface GeneViewModel {
  clipId: string
  gene: GeneStructure
  anchorVariant: GenomicVariant | null
  axisNote: string | null
  cohort: boolean
  hasClinvar: boolean
}

const EXON_PX = 22
const TOP_PX = 46
const EXON_FILL = 'rgb(var(--v-theme-primary))'
const BAND = '#D32F2F'

export function drawGeneView(ctx: TrackDrawContext, model: GeneViewModel): void {
  const { gene } = model
  const { x, height, plotWidth } = ctx
  const axisY = height - 42
  const clinvarY = axisY - 22
  const exonY = (model.hasClinvar ? clinvarY - 18 : axisY - 12) - EXON_PX / 2
  const labelY = exonY - EXON_PX / 2 - 5
  const baseY = labelY - 14
  const g = plotGroup(ctx, model.clipId)

  // Intron line with strand chevrons every 60 px.
  const x1 = Math.max(-10, x(gene.start))
  const x2 = Math.min(plotWidth + 10, x(gene.end))
  g.append('line')
    .attr('x1', x1)
    .attr('x2', x2)
    .attr('y1', exonY)
    .attr('y2', exonY)
    .attr('stroke', TRACK_STYLE.MUTED)
    .attr('stroke-width', 1.5)
  const dir = gene.strand === 1 ? 1 : -1
  for (let cx = x1 + 30; cx < x2 - 10; cx += 60) {
    g.append('path')
      .attr(
        'd',
        `M ${cx - 3 * dir} ${exonY - 4} L ${cx + 3 * dir} ${exonY} L ${cx - 3 * dir} ${exonY + 4}`
      )
      .attr('fill', 'none')
      .attr('stroke', TRACK_STYLE.MUTED)
      .attr('stroke-width', 1.2)
  }

  // Exons; the ones a CNV/SV interval overlaps are outlined.
  const a = model.anchorVariant
  const hit = new Set(
    a !== null && isInterval(a) ? exonsInInterval(gene.exons, { start: a.pos, end: a.end }) : []
  )
  const labelItems: Array<{ key: string; x: number; width: number }> = []
  for (const exon of gene.exons) {
    const ex = x(exon.start)
    const ew = Math.max(2, x(exon.end) - ex)
    if (ex + ew < -10 || ex > plotWidth + 10) continue
    const el = g.append('g')
    el.append('rect')
      .attr('x', ex)
      .attr('y', exonY - EXON_PX / 2)
      .attr('width', ew)
      .attr('height', EXON_PX)
      .attr('rx', 2)
      .attr('fill', EXON_FILL)
      .attr('stroke', hit.has(exon) ? BAND : 'none')
      .attr('stroke-width', 2)
    el.append('title').text(
      `Exon ${exon.rank}: ${exon.start.toLocaleString('en-US')}–${exon.end.toLocaleString('en-US')}`
    )
    ctx.bindFeature(el as never, {
      key: `exon-${exon.rank}`,
      name: `Exon ${exon.rank}`,
      start: exon.start,
      end: exon.end
    })
    labelItems.push({ key: String(exon.rank), x: ex + ew / 2, width: 7 * String(exon.rank).length })
  }
  // Exon numbers above the exons; a number that would touch its neighbour is left out (#571).
  const shown = new Set(placeLabels(labelItems, 4))
  for (const item of labelItems) {
    if (!shown.has(item.key)) continue
    g.append('text')
      .attr('x', item.x)
      .attr('y', labelY)
      .attr('text-anchor', 'middle')
      .attr('fill', TRACK_STYLE.MUTED)
      .attr('font-size', '10px')
      .text(item.key)
  }

  lollipopTrack(g, ctx, ['variant', 'cohort'], baseY, baseY - TOP_PX)
  if (model.hasClinvar) diamondTrack(g, ctx, clinvarY)
  if (a !== null && isInterval(a)) {
    const anchor = ctx.markers.find((m) => m.isAnchor === true)
    const bx = x(a.pos)
    const el = g.append('g').classed('is-anchor', true)
    el.append('rect')
      .attr('x', bx)
      .attr('width', Math.max(2, x(a.end) - bx))
      .attr('y', exonY - EXON_PX / 2 - 6)
      .attr('height', EXON_PX + 12)
      .attr('fill', BAND)
      .attr('fill-opacity', 0.18)
      .attr('stroke', BAND)
      .attr('stroke-width', 1.5)
    el.append('text')
      .attr('x', Math.min(Math.max(bx + (x(a.end) - bx) / 2, 40), plotWidth - 40))
      .attr('y', TOP_PX)
      .attr('text-anchor', 'middle')
      .attr('fill', TRACK_STYLE.STRONG)
      .attr('font-size', '12px')
      .attr('font-weight', '700')
      .text(anchor?.label ?? a.label)
    if (anchor !== undefined) ctx.bindMarker(el, anchor)
  } else {
    anchorMarker(g, ctx, exonY - EXON_PX / 2, Math.max(TOP_PX, exonY - 190))
  }

  gutterLabel(ctx, (TOP_PX + baseY) / 2, model.cohort ? TRACK_LABELS.cohort : TRACK_LABELS.variant)
  gutterLabel(ctx, exonY, TRACK_LABELS.exons)
  if (model.hasClinvar) gutterLabel(ctx, clinvarY, TRACK_LABELS.clinvar)
  axis(ctx, axisY, geneAxisLabel(gene.chromosome, model.axisNote), genomicTickLabels, true)
}
