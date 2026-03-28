/**
 * D3 v7 lollipop plot rendering engine
 *
 * Renders a protein-level lollipop plot with:
 * - Protein backbone track
 * - Domain rectangles (colored by InterPro type)
 * - Lollipop stems + heads (colored by consequence category)
 * - Optional gnomAD population variant track (below backbone)
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
  ConsequenceCategory
} from '../../../shared/types/protein'
import { DOMAIN_TYPE_COLORS } from '../../../shared/utils/protein-utils'
import type { Dimensions } from './useResizeObserver'

// ─── Types ────────────────────────────────────────────────────────────────────

/** Variants grouped at the same protein position */
interface PositionGroup {
  position: number
  variants: LollipopVariant[]
  maxHeight: number
}

/** Tooltip data exposed to Vue for overlay rendering */
export interface TooltipData {
  visible: boolean
  x: number
  y: number
  type: 'variant' | 'domain' | 'gnomad'
  /** Domain tooltip fields */
  domain?: ProteinDomain
  /** Variant tooltip fields */
  variants?: LollipopVariant[]
  /** gnomAD variant tooltip fields */
  gnomadVariant?: GnomadVariant
}

export interface LollipopPlotOptions {
  svgRef: Ref<SVGSVGElement | null>
  dimensions: Ref<Dimensions>
  proteinLength: Ref<number>
  domains: Ref<ProteinDomain[]>
  variants: Ref<LollipopVariant[]>
  gnomadVariants: Ref<GnomadVariant[]>
  showGnomad: Ref<boolean>
  activeCategories: Ref<Set<ConsequenceCategory>>
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MARGIN = { top: 40, right: 30, bottom: 80, left: 50 }
const BACKBONE_Y_OFFSET = 0.55 // fraction of plot height for backbone
const BACKBONE_HEIGHT = 14
const DOMAIN_HEIGHT = 22
const LOLLIPOP_HEAD_RADIUS = 5
const LOLLIPOP_MIN_STEM = 20
const LOLLIPOP_MAX_STEM = 120
const GNOMAD_TRACK_HEIGHT = 40
const GNOMAD_HEAD_RADIUS = 3
const MINIMAP_HEIGHT = 24

// ─── Composable ───────────────────────────────────────────────────────────────

export function useLollipopPlot(options: LollipopPlotOptions) {
  const {
    svgRef,
    dimensions,
    proteinLength,
    domains,
    variants,
    gnomadVariants,
    showGnomad,
    activeCategories
  } = options

  const tooltip = ref<TooltipData>({
    visible: false,
    x: 0,
    y: 0,
    type: 'variant'
  })

  /** Current D3 zoom transform (for external zoom controls) */
  let currentTransform = d3.zoomIdentity
  let zoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown> | null = null

  // ─── Helper: group variants by position ─────────────────────────────────

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
      maxHeight: Math.min(LOLLIPOP_MAX_STEM, LOLLIPOP_MIN_STEM + group.length * 8)
    }))
  }

  // ─── Main render function ───────────────────────────────────────────────

  function render(): void {
    const svg = svgRef.value
    if (!svg) return

    const { width, height } = dimensions.value
    if (width <= 0 || height <= 0 || proteinLength.value <= 0) return

    const filteredVariants = variants.value.filter((v) =>
      activeCategories.value.has(v.consequenceCategory)
    )
    const groups = groupByPosition(filteredVariants)

    const plotWidth = width - MARGIN.left - MARGIN.right
    const plotHeight = height - MARGIN.top - MARGIN.bottom
    if (plotWidth <= 0 || plotHeight <= 0) return

    const backboneY = MARGIN.top + plotHeight * BACKBONE_Y_OFFSET

    // ── Scales ──────────────────────────────────────────────────────────

    const xScale = d3.scaleLinear().domain([0, proteinLength.value]).range([0, plotWidth])

    // Stem height scale based on variant count at position
    const maxCount = Math.max(1, ...groups.map((g) => g.variants.length))
    const stemScale = d3
      .scaleLinear()
      .domain([1, maxCount])
      .range([LOLLIPOP_MIN_STEM, LOLLIPOP_MAX_STEM])
      .clamp(true)

    // gnomAD frequency scale (log)
    const gnomadFreqs = gnomadVariants.value
      .filter((v) => v.proteinPosition !== null && v.alleleFrequency > 0)
      .map((v) => v.alleleFrequency)
    const gnomadMaxAf = gnomadFreqs.length > 0 ? Math.max(...gnomadFreqs) : 0.01
    const gnomadStemScale = d3
      .scaleLog()
      .domain([1e-6, gnomadMaxAf])
      .range([4, GNOMAD_TRACK_HEIGHT])
      .clamp(true)

    // ── Clear and set up SVG ────────────────────────────────────────────

    const root = d3.select(svg)
    root.selectAll('*').remove()
    root.attr('width', width).attr('height', height)

    // Clip path for main plot area
    root
      .append('defs')
      .append('clipPath')
      .attr('id', 'plot-clip')
      .append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', plotWidth)
      .attr('height', plotHeight + MARGIN.top)

    const mainGroup = root.append('g').attr('transform', `translate(${MARGIN.left},0)`)

    const clipGroup = mainGroup.append('g').attr('clip-path', 'url(#plot-clip)')

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

    // ── Render layers ───────────────────────────────────────────────────

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

    // Lollipop stems + heads
    const lollipopGroup = clipGroup.append('g').attr('class', 'lollipops')
    for (const group of groups) {
      const cx = xScale(group.position)
      const stemHeight = stemScale(group.variants.length)
      const headY = backboneY - BACKBONE_HEIGHT / 2 - stemHeight
      const color = group.variants[0].color
      const isHighlighted = group.variants.some((v) => v.highlighted === true)

      // Stem
      lollipopGroup
        .append('line')
        .attr('x1', cx)
        .attr('y1', backboneY - BACKBONE_HEIGHT / 2)
        .attr('x2', cx)
        .attr('y2', headY)
        .attr('stroke', color)
        .attr('stroke-width', isHighlighted ? 2.5 : 1.5)
        .attr('opacity', isHighlighted ? 1 : 0.6)

      // Head
      const headRadius = isHighlighted
        ? Math.min(LOLLIPOP_HEAD_RADIUS + group.variants.length + 1, 12)
        : Math.min(LOLLIPOP_HEAD_RADIUS + group.variants.length - 1, 10)
      lollipopGroup
        .append('circle')
        .attr('cx', cx)
        .attr('cy', headY)
        .attr('r', headRadius)
        .attr('fill', color)
        .attr('stroke', isHighlighted ? '#FFD700' : '#fff')
        .attr('stroke-width', isHighlighted ? 3 : 1.5)
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

    // gnomAD track (below backbone)
    if (showGnomad.value && gnomadVariants.value.length > 0) {
      const gnomadGroup = clipGroup.append('g').attr('class', 'gnomad')
      const gnomadBaseY = backboneY + BACKBONE_HEIGHT / 2 + 4

      for (const gv of gnomadVariants.value) {
        if (gv.proteinPosition === null) continue
        const cx = xScale(gv.proteinPosition)
        const stemH = gv.alleleFrequency > 0 ? gnomadStemScale(gv.alleleFrequency) : 4
        const headY = gnomadBaseY + stemH

        // Stem
        gnomadGroup
          .append('line')
          .attr('x1', cx)
          .attr('y1', gnomadBaseY)
          .attr('x2', cx)
          .attr('y2', headY)
          .attr('stroke', '#6A89CC')
          .attr('stroke-width', 1)
          .attr('opacity', 0.4)

        // Head
        gnomadGroup
          .append('circle')
          .attr('cx', cx)
          .attr('cy', headY)
          .attr('r', GNOMAD_HEAD_RADIUS)
          .attr('fill', '#6A89CC')
          .attr('stroke', '#fff')
          .attr('stroke-width', 1)
          .attr('opacity', 0.7)
          .attr('cursor', 'pointer')
          .on('mouseenter', (event: MouseEvent) => {
            tooltip.value = {
              visible: true,
              x: event.clientX,
              y: event.clientY,
              type: 'gnomad',
              gnomadVariant: gv
            }
          })
          .on('mousemove', (event: MouseEvent) => {
            tooltip.value = { ...tooltip.value, x: event.clientX, y: event.clientY }
          })
          .on('mouseleave', () => {
            tooltip.value = { ...tooltip.value, visible: false }
          })
      }
    }

    // ── X-Axis ──────────────────────────────────────────────────────────

    const axisY = showGnomad.value
      ? backboneY + BACKBONE_HEIGHT / 2 + GNOMAD_TRACK_HEIGHT + 16
      : backboneY + BACKBONE_HEIGHT / 2 + 16
    const xAxis = d3.axisBottom(xScale).ticks(Math.min(10, proteinLength.value))
    mainGroup
      .append('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0,${axisY})`)
      .call(xAxis)
      .selectAll('text')
      .attr('fill', '#666')

    // Axis label
    mainGroup
      .append('text')
      .attr('x', plotWidth / 2)
      .attr('y', axisY + 35)
      .attr('text-anchor', 'middle')
      .attr('fill', '#999')
      .attr('font-size', '11px')
      .text('Amino Acid Position')

    // ── Minimap ─────────────────────────────────────────────────────────

    const minimapY = height - MINIMAP_HEIGHT - 8
    const miniGroup = root
      .append('g')
      .attr('class', 'minimap')
      .attr('transform', `translate(${MARGIN.left},${minimapY})`)

    // Minimap backbone
    miniGroup
      .append('rect')
      .attr('x', 0)
      .attr('y', MINIMAP_HEIGHT / 2 - 2)
      .attr('width', plotWidth)
      .attr('height', 4)
      .attr('fill', '#E0E0E0')
      .attr('rx', 2)

    // Minimap domains
    const miniXScale = d3.scaleLinear().domain([0, proteinLength.value]).range([0, plotWidth])
    for (const domain of domains.value) {
      const domainColor = DOMAIN_TYPE_COLORS[domain.type.toLowerCase()] ?? '#9E9E9E'
      miniGroup
        .append('rect')
        .attr('x', miniXScale(domain.start))
        .attr('y', MINIMAP_HEIGHT / 2 - 4)
        .attr('width', Math.max(1, miniXScale(domain.end) - miniXScale(domain.start)))
        .attr('height', 8)
        .attr('fill', domainColor)
        .attr('opacity', 0.6)
        .attr('rx', 1)
    }

    // Minimap variant ticks
    for (const group of groups) {
      miniGroup
        .append('line')
        .attr('x1', miniXScale(group.position))
        .attr('y1', 2)
        .attr('x2', miniXScale(group.position))
        .attr('y2', MINIMAP_HEIGHT - 2)
        .attr('stroke', group.variants[0].color)
        .attr('stroke-width', 1)
        .attr('opacity', 0.5)
    }

    // Viewport highlight rectangle
    miniGroup
      .append('rect')
      .attr('class', 'minimap-viewport')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', plotWidth)
      .attr('height', MINIMAP_HEIGHT)
      .attr('fill', 'rgba(var(--v-theme-primary), 0.1)')
      .attr('stroke', 'rgba(var(--v-theme-primary), 0.4)')
      .attr('stroke-width', 1)
      .attr('rx', 2)

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

    // Update lollipops
    const filteredVariants = variants.value.filter((v) =>
      activeCategories.value.has(v.consequenceCategory)
    )
    const groups = groupByPosition(filteredVariants)
    const backboneY =
      MARGIN.top + (dimensions.value.height - MARGIN.top - MARGIN.bottom) * BACKBONE_Y_OFFSET

    clipGroup.selectAll('.lollipops line').each(function (_d, i) {
      const group = groups[i]
      if (group !== undefined) {
        d3.select(this).attr('x1', newXScale(group.position)).attr('x2', newXScale(group.position))
      }
    })

    clipGroup.selectAll('.lollipops circle').each(function (_d, i) {
      const group = groups[i]
      if (group !== undefined) {
        d3.select(this).attr('cx', newXScale(group.position))
      }
    })

    // Update gnomAD
    if (showGnomad.value) {
      let gnomadIdx = 0
      clipGroup.selectAll('.gnomad line').each(function () {
        const gv = getGnomadAtIndex(gnomadIdx)
        if (gv?.proteinPosition !== null && gv?.proteinPosition !== undefined) {
          d3.select(this)
            .attr('x1', newXScale(gv.proteinPosition))
            .attr('x2', newXScale(gv.proteinPosition))
        }
        gnomadIdx++
      })

      gnomadIdx = 0
      clipGroup.selectAll('.gnomad circle').each(function () {
        const gv = getGnomadAtIndex(gnomadIdx)
        if (gv?.proteinPosition !== null && gv?.proteinPosition !== undefined) {
          d3.select(this).attr('cx', newXScale(gv.proteinPosition))
        }
        gnomadIdx++
      })
    }

    // Update x-axis
    const axisY = showGnomad.value
      ? backboneY + BACKBONE_HEIGHT / 2 + GNOMAD_TRACK_HEIGHT + 16
      : backboneY + BACKBONE_HEIGHT / 2 + 16
    const xAxis = d3.axisBottom(newXScale).ticks(Math.min(10, proteinLength.value))
    root
      .select('.x-axis')
      .attr('transform', `translate(0,${axisY})`)
      .call(xAxis as never)

    // Update minimap viewport
    const viewStart = Math.max(0, -transform.x / transform.k)
    const viewWidth = plotWidth / transform.k
    root
      .select('.minimap-viewport')
      .attr('x', (viewStart / plotWidth) * plotWidth)
      .attr('width', Math.min(plotWidth, (viewWidth / plotWidth) * plotWidth))
  }

  /** Helper to get gnomAD variant at render index (skipping null positions) */
  function getGnomadAtIndex(index: number): GnomadVariant | undefined {
    let count = 0
    for (const gv of gnomadVariants.value) {
      if (gv.proteinPosition === null) continue
      if (count === index) return gv
      count++
    }
    return undefined
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
      showGnomad.value,
      activeCategories.value
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
