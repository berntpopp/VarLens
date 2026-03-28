/**
 * D3 v7 lollipop plot rendering engine
 *
 * Renders a protein-level lollipop plot with:
 * - Protein backbone track
 * - Domain rectangles (colored by InterPro type)
 * - Highlighted (user) variants as prominent lollipops ABOVE backbone
 * - Non-highlighted (case) variants as standard lollipops ABOVE backbone
 * - gnomAD population variants as small dots BELOW backbone (density-aware)
 * - X-axis with amino acid positions
 * - Minimap with viewport highlight
 * - D3 zoom behavior
 * - Tooltip data exposed for Vue overlay rendering
 * - SVG/PNG export
 */

import { ref, watchEffect, type Ref } from 'vue'
import * as d3 from 'd3'
import type {
  ProteinDomain,
  LollipopVariant,
  GnomadVariant,
  ClinVarVariant,
  ConsequenceCategory,
  ClinVarSignificance
} from '../../../shared/types/protein'
import {
  DOMAIN_TYPE_COLORS,
  CLINVAR_COLORS,
  getConsequenceCategory,
  getConsequenceColor,
  getClinVarCategory
} from '../../../shared/utils/protein-utils'
import type { Dimensions } from './useResizeObserver'

// ─── Types ────────────────────────────────────────────────────────────────────

/** Variants grouped at the same protein position */
interface PositionGroup {
  position: number
  variants: LollipopVariant[]
  maxHeight: number
  /** Whether this group contains the highlighted (selected) variant */
  hasHighlighted: boolean
}

/** gnomAD variants grouped at the same protein position for density rendering */
interface GnomadPositionGroup {
  position: number
  variants: GnomadVariant[]
  maxAf: number
  /** Dominant consequence category in this group */
  dominantCategory: ConsequenceCategory
}

/** ClinVar variants grouped at the same protein position */
interface ClinVarPositionGroup {
  position: number
  variants: ClinVarVariant[]
  /** Dominant ClinVar significance category */
  dominantSignificance: ClinVarSignificance
}

/** Tooltip data exposed to Vue for overlay rendering */
export interface TooltipData {
  visible: boolean
  x: number
  y: number
  type: 'variant' | 'domain' | 'gnomad' | 'clinvar'
  /** Domain tooltip fields */
  domain?: ProteinDomain
  /** Variant tooltip fields */
  variants?: LollipopVariant[]
  /** gnomAD variant tooltip fields */
  gnomadVariant?: GnomadVariant
  /** gnomAD group tooltip */
  gnomadGroup?: GnomadPositionGroup
  /** ClinVar group tooltip */
  clinvarGroup?: ClinVarPositionGroup
}

export interface LollipopPlotOptions {
  svgRef: Ref<SVGSVGElement | null>
  dimensions: Ref<Dimensions>
  proteinLength: Ref<number>
  domains: Ref<ProteinDomain[]>
  variants: Ref<LollipopVariant[]>
  gnomadVariants: Ref<GnomadVariant[]>
  clinvarVariants: Ref<ClinVarVariant[]>
  showGnomad: Ref<boolean>
  activeCategories: Ref<Set<ConsequenceCategory>>
  activeClinvarCategories: Ref<Set<ClinVarSignificance>>
  /** Consequence category filter for ClinVar variants */
  activeClinvarConsequences: Ref<Set<ConsequenceCategory>>
  /** Maximum allele frequency filter for gnomAD variants */
  gnomadMaxAf: Ref<number>
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MARGIN = { top: 40, right: 30, bottom: 80, left: 50 }
const BACKBONE_Y_OFFSET = 0.55 // fraction of plot height for backbone (slightly below center for lollipop room)
const BACKBONE_HEIGHT = 14
const DOMAIN_HEIGHT = 22
/** Radius for the highlighted (selected) variant head */
const HIGHLIGHTED_HEAD_RADIUS = 10
/** Stroke width for the highlighted variant stem */
const HIGHLIGHTED_STEM_WIDTH = 3
/** Minimum stem height for highlighted variant */
const HIGHLIGHTED_MIN_STEM = 60
/** Maximum stem height for highlighted variant */
const HIGHLIGHTED_MAX_STEM = 140
/** Radius for non-highlighted user/case variant heads */
const NORMAL_HEAD_RADIUS = 5
const LOLLIPOP_MIN_STEM = 20
const LOLLIPOP_MAX_STEM = 100
const GNOMAD_TRACK_HEIGHT = 30
/** Radius for gnomAD dots (small) */
const GNOMAD_DOT_RADIUS_MIN = 1.5
const GNOMAD_DOT_RADIUS_MAX = 4
const CLINVAR_TRACK_HEIGHT = 26
/** Half-size of ClinVar diamond shape */
const CLINVAR_DIAMOND_SIZE = 4

// ─── Composable ───────────────────────────────────────────────────────────────

export function useLollipopPlot(options: LollipopPlotOptions) {
  const {
    svgRef,
    dimensions,
    proteinLength,
    domains,
    variants,
    gnomadVariants,
    clinvarVariants,
    showGnomad,
    activeCategories,
    activeClinvarCategories,
    activeClinvarConsequences,
    gnomadMaxAf
  } = options

  const tooltip = ref<TooltipData>({
    visible: false,
    x: 0,
    y: 0,
    type: 'variant'
  })

  /** Unique ID for clipPath to avoid collisions when multiple plots render */
  const clipId = `lollipop-clip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  /** Current D3 zoom transform (for external zoom controls) */
  let currentTransform = d3.zoomIdentity
  let zoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown> | null = null

  // ─── Helper: group user variants by position ─────────────────────────

  function groupByPosition(vars: LollipopVariant[]): PositionGroup[] {
    const map = new Map<number, LollipopVariant[]>()
    for (const v of vars) {
      const existing = map.get(v.proteinPosition)
      if (existing) {
        existing.push(v)
      } else {
        map.set(v.proteinPosition, [v])
      }
    }
    return Array.from(map.entries()).map(([position, group]) => ({
      position,
      variants: group,
      maxHeight: Math.min(LOLLIPOP_MAX_STEM, LOLLIPOP_MIN_STEM + group.length * 8),
      hasHighlighted: group.some((v) => v.highlighted === true)
    }))
  }

  // ─── Helper: group gnomAD variants by position for density ───────────

  function groupGnomadByPosition(vars: GnomadVariant[]): GnomadPositionGroup[] {
    const map = new Map<number, GnomadVariant[]>()
    for (const gv of vars) {
      if (gv.proteinPosition === null) continue
      const existing = map.get(gv.proteinPosition)
      if (existing) {
        existing.push(gv)
      } else {
        map.set(gv.proteinPosition, [gv])
      }
    }
    return Array.from(map.entries()).map(([position, group]) => {
      // Find the most common consequence category
      const catCounts = new Map<ConsequenceCategory, number>()
      for (const gv of group) {
        const cat = getConsequenceCategory(gv.consequence)
        catCounts.set(cat, (catCounts.get(cat) ?? 0) + 1)
      }
      let dominantCategory: ConsequenceCategory = 'other'
      let maxCount = 0
      for (const [cat, count] of catCounts) {
        if (count > maxCount) {
          maxCount = count
          dominantCategory = cat
        }
      }

      return {
        position,
        variants: group,
        maxAf: Math.max(...group.map((gv) => gv.alleleFrequency)),
        dominantCategory
      }
    })
  }

  // ─── Helper: group ClinVar variants by position ────────────────────────

  function groupClinVarByPosition(vars: ClinVarVariant[]): ClinVarPositionGroup[] {
    const map = new Map<number, ClinVarVariant[]>()
    for (const cv of vars) {
      if (cv.proteinPosition === null) continue
      const existing = map.get(cv.proteinPosition)
      if (existing) {
        existing.push(cv)
      } else {
        map.set(cv.proteinPosition, [cv])
      }
    }
    return Array.from(map.entries()).map(([position, group]) => {
      // Find the most severe significance category
      const sigCounts = new Map<ClinVarSignificance, number>()
      for (const cv of group) {
        const cat = getClinVarCategory(cv.clinicalSignificance)
        sigCounts.set(cat, (sigCounts.get(cat) ?? 0) + 1)
      }
      let dominantSignificance: ClinVarSignificance = 'other'
      let maxCount = 0
      for (const [sig, count] of sigCounts) {
        if (count > maxCount) {
          maxCount = count
          dominantSignificance = sig
        }
      }

      return {
        position,
        variants: group,
        dominantSignificance
      }
    })
  }

  // ─── Main render function ───────────────────────────────────────────────

  function render(): void {
    const svg = svgRef.value
    if (!svg) return

    const { width, height } = dimensions.value
    if (width <= 0 || height <= 0 || proteinLength.value <= 0) return

    // Case/user variants are always shown (highlighted variant must always be visible)
    const groups = groupByPosition(variants.value)

    // Separate highlighted and non-highlighted groups
    const highlightedGroups = groups.filter((g) => g.hasHighlighted)
    const normalGroups = groups.filter((g) => !g.hasHighlighted)

    const plotWidth = width - MARGIN.left - MARGIN.right
    const plotHeight = height - MARGIN.top - MARGIN.bottom
    if (plotWidth <= 0 || plotHeight <= 0) return

    const backboneY = MARGIN.top + plotHeight * BACKBONE_Y_OFFSET

    // ── Scales ──────────────────────────────────────────────────────────

    const xScale = d3.scaleLinear().domain([0, proteinLength.value]).range([0, plotWidth])

    // Stem height scale based on variant count at position (for non-highlighted)
    const maxCount = Math.max(1, ...normalGroups.map((g) => g.variants.length))
    const stemScale = d3
      .scaleLinear()
      .domain([1, maxCount])
      .range([LOLLIPOP_MIN_STEM, LOLLIPOP_MAX_STEM])
      .clamp(true)

    // Filter gnomAD variants by AF threshold AND consequence category
    const filteredGnomad = gnomadVariants.value.filter(
      (gv) =>
        gv.proteinPosition !== null &&
        gv.alleleFrequency <= gnomadMaxAf.value &&
        activeCategories.value.has(getConsequenceCategory(gv.consequence))
    )
    const gnomadGroups = groupGnomadByPosition(filteredGnomad)

    // gnomAD dot radius scale based on group size (density)
    const gnomadMaxGroupSize = Math.max(1, ...gnomadGroups.map((g) => g.variants.length))
    const gnomadRadiusScale = d3
      .scaleSqrt()
      .domain([1, gnomadMaxGroupSize])
      .range([GNOMAD_DOT_RADIUS_MIN, GNOMAD_DOT_RADIUS_MAX])
      .clamp(true)

    // gnomAD Y position scale based on allele frequency
    const gnomadAfs = filteredGnomad
      .filter((v) => v.alleleFrequency > 0)
      .map((v) => v.alleleFrequency)
    const gnomadMaxAfValue = gnomadAfs.length > 0 ? Math.max(...gnomadAfs) : 0.01
    const gnomadYScale = d3
      .scaleLog()
      .domain([1e-6, gnomadMaxAfValue])
      .range([2, GNOMAD_TRACK_HEIGHT - 4])
      .clamp(true)

    // ── Clear and set up SVG ────────────────────────────────────────────

    const root = d3.select(svg)
    root.selectAll('*').remove()
    root.attr('width', width).attr('height', height)

    // Clip path for main plot area
    root
      .append('defs')
      .append('clipPath')
      .attr('id', clipId)
      .append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', plotWidth)
      .attr('height', plotHeight + MARGIN.top)

    // Drop shadow filter for highlighted variant
    const defs = root.select('defs')
    const filter = defs.append('filter').attr('id', 'highlight-shadow')
    filter
      .append('feDropShadow')
      .attr('dx', 0)
      .attr('dy', 1)
      .attr('stdDeviation', 3)
      .attr('flood-color', '#FFD700')
      .attr('flood-opacity', 0.6)

    const mainGroup = root.append('g').attr('transform', `translate(${MARGIN.left},0)`)

    const clipGroup = mainGroup.append('g').attr('clip-path', `url(#${clipId})`)

    // ── Zoom behavior ───────────────────────────────────────────────────

    zoomBehavior = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 20])
      .translateExtent([
        [0, 0],
        [plotWidth, height]
      ])
      .extent([
        [0, 0],
        [plotWidth, height]
      ])
      .on('zoom', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        currentTransform = event.transform
        updateZoom(event.transform)
      })

    root.call(zoomBehavior)
    // Prevent scroll wheel from scrolling the page when hovering the plot
    root.on('wheel.zoom', null)
    root.call(zoomBehavior).on('wheel.zoom', function (event: WheelEvent) {
      event.preventDefault()
      if (zoomBehavior) {
        // Manual zoom on wheel
        const direction = event.deltaY < 0 ? 1.1 : 0.9
        const point = d3.pointer(event, this)
        const transform = currentTransform
        const newK = Math.min(20, Math.max(1, transform.k * direction))
        const newX =
          point[0] - MARGIN.left - (point[0] - MARGIN.left - transform.x) * (newK / transform.k)
        const newTransform = d3.zoomIdentity.translate(newX, 0).scale(newK)
        d3.select(this).call(zoomBehavior!.transform, newTransform)
      }
    })

    // ── Filter ClinVar variants by significance AND consequence categories ──
    const filteredClinVar = clinvarVariants.value.filter((cv) => {
      if (cv.proteinPosition === null) return false
      const sigCat = getClinVarCategory(cv.clinicalSignificance)
      const consCat = getConsequenceCategory(cv.consequence)
      return (
        activeClinvarCategories.value.has(sigCat) && activeClinvarConsequences.value.has(consCat)
      )
    })
    const clinvarGroups = groupClinVarByPosition(filteredClinVar)

    // ── Render layers ───────────────────────────────────────────────────

    // ClinVar track (BELOW backbone, ABOVE gnomAD)
    if (clinvarGroups.length > 0) {
      const clinvarGroup = clipGroup.append('g').attr('class', 'clinvar')
      const clinvarBaseY = backboneY + BACKBONE_HEIGHT / 2 + 6

      for (const group of clinvarGroups) {
        const cx = xScale(group.position)
        const cy = clinvarBaseY + CLINVAR_TRACK_HEIGHT / 2
        const color = CLINVAR_COLORS[group.dominantSignificance]
        const size = Math.min(CLINVAR_DIAMOND_SIZE + group.variants.length - 1, 7)

        // Diamond shape (rotated square)
        const diamondPath = `M ${cx} ${cy - size} L ${cx + size} ${cy} L ${cx} ${cy + size} L ${cx - size} ${cy} Z`
        clinvarGroup
          .append('path')
          .attr('d', diamondPath)
          .attr('fill', color)
          .attr('opacity', 0.7)
          .attr('stroke', '#fff')
          .attr('stroke-width', 0.5)
          .attr('cursor', 'pointer')
          .on('mouseenter', (event: MouseEvent) => {
            tooltip.value = {
              visible: true,
              x: event.clientX,
              y: event.clientY,
              type: 'clinvar',
              clinvarGroup: group
            }
          })
          .on('mousemove', (event: MouseEvent) => {
            tooltip.value = { ...tooltip.value, x: event.clientX, y: event.clientY }
          })
          .on('mouseleave', () => {
            tooltip.value = { ...tooltip.value, visible: false }
          })
      }

      // ClinVar track label
      clinvarGroup
        .append('text')
        .attr('x', -4)
        .attr('y', clinvarBaseY + CLINVAR_TRACK_HEIGHT / 2)
        .attr('text-anchor', 'end')
        .attr('dominant-baseline', 'middle')
        .attr('fill', '#999')
        .attr('font-size', '11px')
        .text('ClinVar')
    }

    // gnomAD track (BELOW ClinVar) - render after ClinVar
    if (showGnomad.value && gnomadGroups.length > 0) {
      const gnomadGroup = clipGroup.append('g').attr('class', 'gnomad')
      const gnomadBaseY =
        backboneY +
        BACKBONE_HEIGHT / 2 +
        6 +
        (clinvarGroups.length > 0 ? CLINVAR_TRACK_HEIGHT + 4 : 0)

      for (const group of gnomadGroups) {
        const cx = xScale(group.position)
        const yOffset = group.maxAf > 0 ? gnomadYScale(group.maxAf) : 2
        const cy = gnomadBaseY + yOffset
        const r = gnomadRadiusScale(group.variants.length)
        const color = getConsequenceColor(group.variants[0].consequence)

        // Dot (no stem for cleaner look)
        gnomadGroup
          .append('circle')
          .attr('cx', cx)
          .attr('cy', cy)
          .attr('r', r)
          .attr('fill', color)
          .attr('opacity', 0.45)
          .attr('stroke', 'none')
          .attr('cursor', 'pointer')
          .on('mouseenter', (event: MouseEvent) => {
            tooltip.value = {
              visible: true,
              x: event.clientX,
              y: event.clientY,
              type: 'gnomad',
              gnomadVariant: group.variants[0],
              gnomadGroup: group
            }
          })
          .on('mousemove', (event: MouseEvent) => {
            tooltip.value = { ...tooltip.value, x: event.clientX, y: event.clientY }
          })
          .on('mouseleave', () => {
            tooltip.value = { ...tooltip.value, visible: false }
          })
      }

      // gnomAD track label
      gnomadGroup
        .append('text')
        .attr('x', -4)
        .attr('y', gnomadBaseY + GNOMAD_TRACK_HEIGHT / 2)
        .attr('text-anchor', 'end')
        .attr('dominant-baseline', 'middle')
        .attr('fill', '#999')
        .attr('font-size', '11px')
        .text('gnomAD')
    }

    // Backbone
    const backboneGroup = clipGroup.append('g').attr('class', 'backbone')
    backboneGroup
      .append('rect')
      .attr('x', xScale(0))
      .attr('y', backboneY - BACKBONE_HEIGHT / 2)
      .attr('width', xScale(proteinLength.value) - xScale(0))
      .attr('height', BACKBONE_HEIGHT)
      .attr('fill', '#E0E0E0')
      .attr('rx', 4)

    // Domains
    const domainsGroup = clipGroup.append('g').attr('class', 'domains')
    for (const domain of domains.value) {
      const domainColor = DOMAIN_TYPE_COLORS[domain.type.toLowerCase()] ?? '#9E9E9E'
      domainsGroup
        .append('rect')
        .attr('x', xScale(domain.start))
        .attr('y', backboneY - DOMAIN_HEIGHT / 2)
        .attr('width', Math.max(2, xScale(domain.end) - xScale(domain.start)))
        .attr('height', DOMAIN_HEIGHT)
        .attr('fill', domainColor)
        .attr('rx', 3)
        .attr('opacity', 0.85)
        .attr('cursor', 'pointer')
        .on('mouseenter', (event: MouseEvent) => {
          tooltip.value = {
            visible: true,
            x: event.clientX,
            y: event.clientY,
            type: 'domain',
            domain
          }
        })
        .on('mousemove', (event: MouseEvent) => {
          tooltip.value = { ...tooltip.value, x: event.clientX, y: event.clientY }
        })
        .on('mouseleave', () => {
          tooltip.value = { ...tooltip.value, visible: false }
        })
    }

    // ── Non-highlighted (case) variant lollipops ──────────────────────
    const lollipopGroup = clipGroup.append('g').attr('class', 'lollipops')
    for (const group of normalGroups) {
      const cx = xScale(group.position)
      const stemHeight = stemScale(group.variants.length)
      const headY = backboneY - BACKBONE_HEIGHT / 2 - stemHeight
      const color = group.variants[0].color

      // Stem
      lollipopGroup
        .append('line')
        .attr('x1', cx)
        .attr('y1', backboneY - BACKBONE_HEIGHT / 2)
        .attr('x2', cx)
        .attr('y2', headY)
        .attr('stroke', color)
        .attr('stroke-width', 1.5)
        .attr('opacity', 0.5)

      // Head
      const headRadius = Math.min(NORMAL_HEAD_RADIUS + group.variants.length - 1, 8)
      lollipopGroup
        .append('circle')
        .attr('cx', cx)
        .attr('cy', headY)
        .attr('r', headRadius)
        .attr('fill', color)
        .attr('stroke', '#fff')
        .attr('stroke-width', 1)
        .attr('opacity', 0.7)
        .attr('cursor', 'pointer')
        .on('mouseenter', (event: MouseEvent) => {
          tooltip.value = {
            visible: true,
            x: event.clientX,
            y: event.clientY,
            type: 'variant',
            variants: group.variants
          }
        })
        .on('mousemove', (event: MouseEvent) => {
          tooltip.value = { ...tooltip.value, x: event.clientX, y: event.clientY }
        })
        .on('mouseleave', () => {
          tooltip.value = { ...tooltip.value, visible: false }
        })
    }

    // ── Highlighted (selected) variant lollipops ─── render LAST for z-order
    const highlightGroup = clipGroup.append('g').attr('class', 'highlighted')
    // Use ~70% of available space above backbone for the highlighted stem
    const availableAbove = backboneY - BACKBONE_HEIGHT / 2 - MARGIN.top
    const highlightStemHeight = Math.min(
      HIGHLIGHTED_MAX_STEM,
      Math.max(HIGHLIGHTED_MIN_STEM, availableAbove * 0.7)
    )
    for (const group of highlightedGroups) {
      const cx = xScale(group.position)
      const stemHeight = highlightStemHeight
      const headY = backboneY - BACKBONE_HEIGHT / 2 - stemHeight
      const highlightedVariant = group.variants.find((v) => v.highlighted === true)
      const color = highlightedVariant?.color ?? group.variants[0].color

      // Stem - thick and prominent
      highlightGroup
        .append('line')
        .attr('x1', cx)
        .attr('y1', backboneY - BACKBONE_HEIGHT / 2)
        .attr('x2', cx)
        .attr('y2', headY)
        .attr('stroke', color)
        .attr('stroke-width', HIGHLIGHTED_STEM_WIDTH)
        .attr('opacity', 1)

      // Outer glow ring
      highlightGroup
        .append('circle')
        .attr('cx', cx)
        .attr('cy', headY)
        .attr('r', HIGHLIGHTED_HEAD_RADIUS + 4)
        .attr('fill', 'none')
        .attr('stroke', '#FFD700')
        .attr('stroke-width', 2)
        .attr('opacity', 0.4)
        .attr('filter', 'url(#highlight-shadow)')

      // Head - large and prominent
      highlightGroup
        .append('circle')
        .attr('cx', cx)
        .attr('cy', headY)
        .attr('r', HIGHLIGHTED_HEAD_RADIUS)
        .attr('fill', color)
        .attr('stroke', '#FFD700')
        .attr('stroke-width', 3)
        .attr('cursor', 'pointer')
        .attr('filter', 'url(#highlight-shadow)')
        .on('mouseenter', (event: MouseEvent) => {
          tooltip.value = {
            visible: true,
            x: event.clientX,
            y: event.clientY,
            type: 'variant',
            variants: group.variants
          }
        })
        .on('mousemove', (event: MouseEvent) => {
          tooltip.value = { ...tooltip.value, x: event.clientX, y: event.clientY }
        })
        .on('mouseleave', () => {
          tooltip.value = { ...tooltip.value, visible: false }
        })

      // Label above highlighted variant
      if (highlightedVariant !== undefined && highlightedVariant.aaChange !== null) {
        highlightGroup
          .append('text')
          .attr('x', cx)
          .attr('y', headY - HIGHLIGHTED_HEAD_RADIUS - 8)
          .attr('text-anchor', 'middle')
          .attr('fill', '#333')
          .attr('font-size', '13px')
          .attr('font-weight', '700')
          .text(highlightedVariant.aaChange)
      }
    }

    // ── X-Axis ──────────────────────────────────────────────────────────

    let axisY = backboneY + BACKBONE_HEIGHT / 2 + 16
    if (clinvarGroups.length > 0) {
      axisY += CLINVAR_TRACK_HEIGHT + 4
    }
    if (showGnomad.value && gnomadGroups.length > 0) {
      axisY += GNOMAD_TRACK_HEIGHT
    }
    const xAxis = d3.axisBottom(xScale).ticks(Math.min(10, proteinLength.value))
    const xAxisGroup = mainGroup
      .append('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0,${axisY})`)
      .call(xAxis)
    xAxisGroup.selectAll('text').attr('fill', '#666').attr('font-size', '12px')
    xAxisGroup.selectAll('line').attr('stroke', '#bbb')
    xAxisGroup.selectAll('path').attr('stroke', '#bbb')

    // Axis label
    mainGroup
      .append('text')
      .attr('x', plotWidth / 2)
      .attr('y', axisY + 38)
      .attr('text-anchor', 'middle')
      .attr('fill', '#666')
      .attr('font-size', '13px')
      .text('Amino Acid Position')

    // Apply current transform
    if (currentTransform.k !== 1) {
      updateZoom(currentTransform)
    }
  }

  // ─── Zoom update function ─────────────────────────────────────────────

  function updateZoom(transform: d3.ZoomTransform): void {
    const svg = svgRef.value
    if (!svg) return

    const root = d3.select(svg)
    const { width } = dimensions.value
    const plotWidth = width - MARGIN.left - MARGIN.right
    if (plotWidth <= 0) return

    const xScale = d3.scaleLinear().domain([0, proteinLength.value]).range([0, plotWidth])

    const newXScale = transform.rescaleX(xScale)

    // Update clip group elements with new scale
    const clipGroup = root.select('g').select('[clip-path]')

    // Update backbone
    clipGroup
      .select('.backbone rect')
      .attr('x', newXScale(0))
      .attr('width', newXScale(proteinLength.value) - newXScale(0))

    // Update domains
    clipGroup.selectAll('.domains rect').each(function (_d, i) {
      const domain = domains.value[i]
      if (domain !== undefined) {
        d3.select(this)
          .attr('x', newXScale(domain.start))
          .attr('width', Math.max(2, newXScale(domain.end) - newXScale(domain.start)))
      }
    })

    // Update non-highlighted lollipops
    const groups = groupByPosition(variants.value)
    const normalGroups = groups.filter((g) => !g.hasHighlighted)
    const highlightedGroups = groups.filter((g) => g.hasHighlighted)

    clipGroup.selectAll('.lollipops line').each(function (_d, i) {
      const group = normalGroups[i]
      if (group !== undefined) {
        d3.select(this).attr('x1', newXScale(group.position)).attr('x2', newXScale(group.position))
      }
    })

    clipGroup.selectAll('.lollipops circle').each(function (_d, i) {
      const group = normalGroups[i]
      if (group !== undefined) {
        d3.select(this).attr('cx', newXScale(group.position))
      }
    })

    // Update highlighted lollipops (each has: line, glow circle, head circle, optional text)
    let highlightIdx = 0
    clipGroup.selectAll('.highlighted line').each(function () {
      const group = highlightedGroups[highlightIdx]
      if (group !== undefined) {
        d3.select(this).attr('x1', newXScale(group.position)).attr('x2', newXScale(group.position))
      }
      highlightIdx++
    })

    highlightIdx = 0
    clipGroup.selectAll('.highlighted circle').each(function () {
      // Circles come in pairs: glow + head per group
      const group = highlightedGroups[Math.floor(highlightIdx / 2)]
      if (group !== undefined) {
        d3.select(this).attr('cx', newXScale(group.position))
      }
      highlightIdx++
    })

    highlightIdx = 0
    clipGroup.selectAll('.highlighted text').each(function () {
      const group = highlightedGroups[highlightIdx]
      if (group !== undefined) {
        d3.select(this).attr('x', newXScale(group.position))
      }
      highlightIdx++
    })

    // Update ClinVar diamonds
    {
      const filteredCV = clinvarVariants.value.filter((cv) => {
        if (cv.proteinPosition === null) return false
        const sigCat = getClinVarCategory(cv.clinicalSignificance)
        const consCat = getConsequenceCategory(cv.consequence)
        return (
          activeClinvarCategories.value.has(sigCat) && activeClinvarConsequences.value.has(consCat)
        )
      })
      const cvGroups = groupClinVarByPosition(filteredCV)

      let cvIdx = 0
      clipGroup.selectAll('.clinvar path').each(function () {
        const group = cvGroups[cvIdx]
        if (group !== undefined) {
          const cx = newXScale(group.position)
          const backboneYLocal =
            MARGIN.top + (dimensions.value.height - MARGIN.top - MARGIN.bottom) * BACKBONE_Y_OFFSET
          const clinvarBaseY = backboneYLocal + BACKBONE_HEIGHT / 2 + 6
          const cy = clinvarBaseY + CLINVAR_TRACK_HEIGHT / 2
          const size = Math.min(CLINVAR_DIAMOND_SIZE + group.variants.length - 1, 7)
          d3.select(this).attr(
            'd',
            `M ${cx} ${cy - size} L ${cx + size} ${cy} L ${cx} ${cy + size} L ${cx - size} ${cy} Z`
          )
        }
        cvIdx++
      })
      clipGroup.selectAll('.clinvar text').attr('x', -4)
    }

    // Update gnomAD
    if (showGnomad.value) {
      const filteredGnomad = gnomadVariants.value.filter(
        (gv) =>
          gv.proteinPosition !== null &&
          gv.alleleFrequency <= gnomadMaxAf.value &&
          activeCategories.value.has(getConsequenceCategory(gv.consequence))
      )
      const gnomadGroups = groupGnomadByPosition(filteredGnomad)

      let gnomadIdx = 0
      clipGroup.selectAll('.gnomad circle').each(function () {
        const group = gnomadGroups[gnomadIdx]
        if (group !== undefined) {
          d3.select(this).attr('cx', newXScale(group.position))
        }
        gnomadIdx++
      })

      // Update gnomAD label position (text element)
      clipGroup.selectAll('.gnomad text').attr('x', -4)
    }

    // Update x-axis (recompute axisY with current track visibility)
    const backboneY =
      MARGIN.top + (dimensions.value.height - MARGIN.top - MARGIN.bottom) * BACKBONE_Y_OFFSET
    const filteredCV = clinvarVariants.value.filter((cv) => {
      if (cv.proteinPosition === null) return false
      const sigCat = getClinVarCategory(cv.clinicalSignificance)
      const consCat = getConsequenceCategory(cv.consequence)
      return (
        activeClinvarCategories.value.has(sigCat) && activeClinvarConsequences.value.has(consCat)
      )
    })
    const cvGroupsForAxis = groupClinVarByPosition(filteredCV)
    let axisY = backboneY + BACKBONE_HEIGHT / 2 + 16
    if (cvGroupsForAxis.length > 0) {
      axisY += CLINVAR_TRACK_HEIGHT + 4
    }
    if (showGnomad.value) {
      const filteredGnomadForAxis = gnomadVariants.value.filter(
        (gv) =>
          gv.proteinPosition !== null &&
          gv.alleleFrequency <= gnomadMaxAf.value &&
          activeCategories.value.has(getConsequenceCategory(gv.consequence))
      )
      if (groupGnomadByPosition(filteredGnomadForAxis).length > 0) {
        axisY += GNOMAD_TRACK_HEIGHT
      }
    }
    const xAxis = d3.axisBottom(newXScale).ticks(Math.min(10, proteinLength.value))
    root
      .select('.x-axis')
      .attr('transform', `translate(0,${axisY})`)
      .call(xAxis as never)
  }

  // ─── Reactive re-rendering ──────────────────────────────────────────

  watchEffect(() => {
    // Access reactive deps to register them for tracking
    const _deps = [
      svgRef.value,
      dimensions.value,
      proteinLength.value,
      domains.value,
      variants.value,
      gnomadVariants.value,
      clinvarVariants.value,
      showGnomad.value,
      activeCategories.value,
      activeClinvarCategories.value,
      activeClinvarConsequences.value,
      gnomadMaxAf.value
    ]
    void _deps

    render()
  })

  // ─── Public API ─────────────────────────────────────────────────────

  function resetZoom(): void {
    const svg = svgRef.value
    if (!svg || !zoomBehavior) return
    currentTransform = d3.zoomIdentity
    d3.select(svg).transition().duration(300).call(zoomBehavior.transform, d3.zoomIdentity)
  }

  function zoomIn(): void {
    const svg = svgRef.value
    if (!svg || !zoomBehavior) return
    d3.select(svg).transition().duration(200).call(zoomBehavior.scaleBy, 1.5)
  }

  function zoomOut(): void {
    const svg = svgRef.value
    if (!svg || !zoomBehavior) return
    d3.select(svg).transition().duration(200).call(zoomBehavior.scaleBy, 0.67)
  }

  function exportSvg(): string {
    const svg = svgRef.value
    if (!svg) return ''
    const serializer = new XMLSerializer()
    const svgString = serializer.serializeToString(svg)
    return `<?xml version="1.0" encoding="UTF-8"?>\n${svgString}`
  }

  function exportPng(): Promise<Blob | null> {
    return new Promise((resolve) => {
      const svg = svgRef.value
      if (!svg) {
        resolve(null)
        return
      }

      const { width, height } = dimensions.value
      const scale = 2 // 2x resolution for high DPI
      const canvas = document.createElement('canvas')
      canvas.width = width * scale
      canvas.height = height * scale
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve(null)
        return
      }

      ctx.scale(scale, scale)

      const serializer = new XMLSerializer()
      const svgString = serializer.serializeToString(svg)
      const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const img = new Image()

      img.onload = () => {
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, width, height)
        ctx.drawImage(img, 0, 0, width, height)
        URL.revokeObjectURL(url)
        canvas.toBlob((pngBlob) => {
          resolve(pngBlob)
        }, 'image/png')
      }

      img.onerror = () => {
        URL.revokeObjectURL(url)
        resolve(null)
      }

      img.src = url
    })
  }

  return {
    tooltip,
    resetZoom,
    zoomIn,
    zoomOut,
    exportSvg,
    exportPng
  }
}
