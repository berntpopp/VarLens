/**
 * Drawing pieces shared by the lollipop and gene-structure views: track
 * labels in the left gutter, lollipop / diamond / dot tracks, the variant of
 * interest (a labelled star, always on top) and the axis.
 */
import * as d3 from 'd3'
import { TRACK_GUTTER_PX } from '../../config/proteinPlotConfig'
import { worstClinvar, type TrackKind, type TrackMarker } from '../../utils/track-window'
import type { TrackDrawContext } from './useTrackPlot'

export type Group = d3.Selection<SVGGElement, unknown, null, undefined>

const MUTED = 'rgba(var(--v-theme-on-surface), 0.62)'
const RULE = 'rgba(var(--v-theme-on-surface), 0.24)'
const STRONG = 'rgb(var(--v-theme-on-surface))'
const HIGHLIGHT = 'rgb(var(--v-theme-primary))'
const ANCHOR_STAR = d3.symbol(d3.symbolStar, 260)

/** The plot group: translated past the gutter, clipped to the plot width. */
export function plotGroup(ctx: TrackDrawContext, clipId: string): Group {
  const { root, plotWidth, height } = ctx
  root
    .append('defs')
    .append('clipPath')
    .attr('id', clipId)
    .append('rect')
    .attr('x', -6)
    .attr('y', 0)
    .attr('width', plotWidth + 12)
    .attr('height', height)
  const main = root.append('g').attr('transform', `translate(${TRACK_GUTTER_PX},0)`)
  return main.append('g').attr('clip-path', `url(#${clipId})`)
}

export function gutterLabel(ctx: TrackDrawContext, y: number, text: string): void {
  ctx.root
    .append('text')
    .attr('x', TRACK_GUTTER_PX - 10)
    .attr('y', y)
    .attr('text-anchor', 'end')
    .attr('dominant-baseline', 'middle')
    .attr('fill', MUTED)
    .attr('font-size', '11px')
    .text(text)
}

const byPosition = (markers: TrackMarker[]): TrackMarker[][] => {
  const groups = new Map<number, TrackMarker[]>()
  for (const m of markers) groups.set(m.position, [...(groups.get(m.position) ?? []), m])
  return [...groups.values()]
}

function emphasis(el: Group, ctx: TrackDrawContext, group: TrackMarker[]): void {
  const keys = group.flatMap((m) => m.binnedKeys ?? [m.key])
  if (keys.some((k) => ctx.highlighted.has(k))) el.classed('is-highlighted', true)
  if (group.some((m) => m.key === ctx.focusedKey)) el.classed('is-focused', true)
}

/** Lollipops above `baseY`: stem height and head size follow the weight (carriers). */
export function lollipopTrack(
  g: Group,
  ctx: TrackDrawContext,
  tracks: TrackKind[],
  baseY: number,
  maxStem: number
): void {
  const markers = ctx.markers.filter((m) => tracks.includes(m.track) && m.isAnchor !== true)
  const groups = byPosition(markers)
  const maxWeight = Math.max(1, ...groups.map((grp) => grp.reduce((s, m) => s + m.weight, 0)))
  const stem = d3
    .scaleSqrt()
    .domain([1, maxWeight])
    .range([14, Math.max(16, maxStem * 0.8)])
    .clamp(true)
  for (const group of groups) {
    const weight = group.reduce((s, m) => s + m.weight, 0)
    const cx = ctx.x(group[0].position)
    const top = baseY - stem(weight)
    const el = g.append('g')
    el.append('line')
      .attr('x1', cx)
      .attr('x2', cx)
      .attr('y1', baseY)
      .attr('y2', top)
      .attr('stroke', group[0].color)
      .attr('stroke-width', 1.5)
      .attr('opacity', 0.6)
    el.append('circle')
      .attr('cx', cx)
      .attr('cy', top)
      .attr('r', Math.min(8, 4 + Math.log2(weight)))
      .attr('fill', group[0].color)
      .attr('stroke', '#fff')
      .attr('stroke-width', 1)
    emphasis(el, ctx, group)
    ctx.bindMarker(el, mergeGroup(group))
  }
}

/** Several markers at one position, shown as one: a bin of them (the tooltip says how many). */
function mergeGroup(group: TrackMarker[]): TrackMarker {
  if (group.length === 1) return group[0]
  // ClinVar: the worst class there colours the diamond (Pathogenic over Benign).
  const lead = group[0].track === 'clinvar' ? worstClinvar(group) : group[0]
  return {
    ...lead,
    weight: group.reduce((s, m) => s + m.weight, 0),
    label: `${lead.label} +${group.length - 1}`,
    binnedKeys: group.flatMap((m) => m.binnedKeys ?? [m.key])
  }
}

const countOf = (group: TrackMarker[]): number =>
  group.reduce((s, m) => s + (m.binnedKeys?.length ?? 1), 0)

/** Diamonds on a row (ClinVar), coloured by class. */
export function diamondTrack(g: Group, ctx: TrackDrawContext, y: number): void {
  for (const group of byPosition(ctx.markers.filter((m) => m.track === 'clinvar'))) {
    const size = Math.min(110, 40 + 14 * (countOf(group) - 1))
    const el = g.append('g')
    el.append('path')
      .attr('transform', `translate(${ctx.x(group[0].position)},${y})`)
      .attr('d', d3.symbol(d3.symbolDiamond, size)() ?? '')
      .attr('fill', worstClinvar(group).color)
      .attr('stroke', '#fff')
      .attr('stroke-width', 0.6)
    emphasis(el, ctx, group)
    ctx.bindMarker(el, mergeGroup(group))
  }
}

/** Small dots on a row (gnomAD), higher = more frequent (log AF). */
export function dotTrack(g: Group, ctx: TrackDrawContext, top: number, rowHeight: number): void {
  const y = d3
    .scaleLog()
    .domain([1e-6, 1])
    .range([top + rowHeight - 3, top + 3])
    .clamp(true)
  for (const m of ctx.markers.filter((mk) => mk.track === 'gnomad')) {
    const el = g.append('g')
    el.append('circle')
      .attr('cx', ctx.x(m.position))
      .attr('cy', y(Math.max(1e-6, m.af ?? 1e-6)))
      .attr('r', m.binnedKeys ? 3 : 2)
      .attr('fill', m.color)
      .attr('opacity', 0.5)
    ctx.bindMarker(el, m)
  }
}

/** The variant of interest: a tall stem, a star and its label, drawn last so it is on top. */
export function anchorMarker(g: Group, ctx: TrackDrawContext, baseY: number, topY: number): void {
  const a = ctx.markers.find((m) => m.isAnchor === true)
  if (a === undefined) return
  const cx = ctx.x(a.position)
  const el = g.append('g').classed('is-anchor', true)
  el.append('line')
    .attr('x1', cx)
    .attr('x2', cx)
    .attr('y1', baseY)
    .attr('y2', topY)
    .attr('stroke', STRONG)
    .attr('stroke-width', 2)
  el.append('path')
    .attr('transform', `translate(${cx},${topY})`)
    .attr('d', ANCHOR_STAR() ?? '')
    .attr('fill', a.color)
    .attr('stroke', STRONG)
    .attr('stroke-width', 1.5)
  el.append('text')
    .attr('x', cx)
    .attr('y', topY - 14)
    .attr('text-anchor', 'middle')
    .attr('fill', STRONG)
    .attr('font-size', '12px')
    .attr('font-weight', '700')
    .attr('paint-order', 'stroke')
    .attr('stroke', 'rgb(var(--v-theme-surface))')
    .attr('stroke-width', 3)
    .text(a.label)
  emphasis(el, ctx, [a])
  ctx.bindMarker(el, a)
}

/** Bottom axis with a title; `labels` formats the ticks. */
export function axis(
  ctx: TrackDrawContext,
  y: number,
  title: string,
  labels: (ticks: number[]) => string[],
  integerOnly = false
): void {
  const ticks = ctx.x
    .ticks(Math.max(2, Math.min(10, Math.floor(ctx.plotWidth / 90))))
    .filter((t) => !integerOnly || Number.isInteger(t))
  const text = labels(ticks)
  const g = ctx.root.append('g').attr('transform', `translate(${TRACK_GUTTER_PX},${y})`)
  g.append('line').attr('x1', 0).attr('x2', ctx.plotWidth).attr('stroke', RULE)
  ticks.forEach((t, i) => {
    const tx = ctx.x(t)
    g.append('line').attr('x1', tx).attr('x2', tx).attr('y2', 5).attr('stroke', RULE)
    g.append('text')
      .attr('x', tx)
      .attr('y', 17)
      .attr('text-anchor', 'middle')
      .attr('fill', MUTED)
      .attr('font-size', '11px')
      .text(text[i])
  })
  g.append('text')
    .attr('x', ctx.plotWidth / 2)
    .attr('y', 34)
    .attr('text-anchor', 'middle')
    .attr('fill', MUTED)
    .attr('font-size', '11px')
    .text(title)
}

export const TRACK_STYLE = { MUTED, RULE, STRONG, HIGHLIGHT }
