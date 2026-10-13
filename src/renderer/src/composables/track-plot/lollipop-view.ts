/**
 * The protein view drawn by useTrackPlot: variants (or cohort carriers) as
 * lollipops above the protein, domains on it, ClinVar and gnomAD rows under
 * it, each labelled in the left gutter, and the amino-acid axis.
 */
import { PLOT_COPY, TRACK_LABELS } from '../../config/proteinPlotConfig'
import { assignLanes, fitLabel } from '../../utils/track-layout'
import type { TrackFeature } from '../../utils/track-window'
import {
  anchorMarker,
  axis,
  clinvarTrack,
  dotTrack,
  gutterLabel,
  lollipopTrack,
  plotGroup,
  TRACK_STYLE
} from './track-draw'
import type { TrackDrawContext } from './useTrackPlot'

export interface ProteinViewModel {
  clipId: string
  length: number
  features: TrackFeature[]
  cohort: boolean
  hasClinvar: boolean
  showGnomad: boolean
}

const LANE_PX = 13
const TOP_PX = 46
const ANCHOR_STEM_PX = 170

export function drawProteinView(ctx: TrackDrawContext, model: ProteinViewModel): void {
  const { height, x } = ctx
  const axisY = height - 42
  const rowsBottom = axisY - 8
  const gnomadTop = model.showGnomad ? rowsBottom - 32 : rowsBottom
  const clinvarY = gnomadTop - (model.hasClinvar ? 14 : 0)
  const lanes = assignLanes(model.features)
  const laneCount = Math.max(1, ...[...lanes.values()].map((l) => l + 1))
  const bandBottom = clinvarY - (model.hasClinvar ? 16 : 4)
  const bandTop = bandBottom - laneCount * LANE_PX
  const baseY = bandTop - 3
  const g = plotGroup(ctx, model.clipId)

  // Protein backbone and its domains (lanes never overlap; labels fit or hide).
  g.append('rect')
    .attr('x', x(0))
    .attr('width', Math.max(0, x(model.length) - x(0)))
    .attr('y', bandTop + (laneCount * LANE_PX) / 2 - 3)
    .attr('height', 6)
    .attr('rx', 3)
    .attr('fill', TRACK_STYLE.RULE)
  for (const f of model.features) {
    if (f.end < ctx.window.start || f.start > ctx.window.end) continue
    const x1 = Math.max(x(f.start), 0)
    const width = Math.max(2, Math.min(x(f.end), ctx.plotWidth) - x1)
    const y = bandTop + (lanes.get(f.key) ?? 0) * LANE_PX
    const el = g.append('g')
    el.append('rect')
      .attr('x', x1)
      .attr('y', y)
      .attr('width', width)
      .attr('height', LANE_PX - 1)
      .attr('rx', 2)
      .attr('fill', f.color ?? '#9E9E9E')
      .attr('opacity', 0.85)
    el.append('title').text(`${f.name} (${f.start}–${f.end})`)
    const label = fitLabel(f.name, width, 6.2)
    if (label !== '') {
      el.append('text')
        .attr('x', x1 + 3)
        .attr('y', y + LANE_PX / 2)
        .attr('dominant-baseline', 'middle')
        .attr('fill', '#fff')
        .attr('font-size', '10px')
        .attr('pointer-events', 'none')
        .text(label)
    }
    ctx.bindFeature(el as never, f)
  }

  lollipopTrack(g, ctx, ['variant', 'cohort'], baseY, baseY - TOP_PX)
  if (model.hasClinvar) clinvarTrack(g, ctx, clinvarY)
  if (model.showGnomad) dotTrack(g, ctx, gnomadTop, 32)
  // A tall but not page-high stem: unmistakable without dwarfing the other tracks.
  anchorMarker(g, ctx, baseY, Math.max(TOP_PX, baseY - ANCHOR_STEM_PX))

  gutterLabel(ctx, (TOP_PX + baseY) / 2, model.cohort ? TRACK_LABELS.cohort : TRACK_LABELS.variant)
  gutterLabel(ctx, bandTop + (laneCount * LANE_PX) / 2, TRACK_LABELS.domains)
  if (model.hasClinvar) gutterLabel(ctx, clinvarY, TRACK_LABELS.clinvar)
  if (model.showGnomad) gutterLabel(ctx, gnomadTop + 16, TRACK_LABELS.gnomad)
  axis(
    ctx,
    axisY,
    PLOT_COPY.proteinAxis,
    (ticks) => ticks.map((t) => t.toLocaleString('en-US')),
    true
  )
}
