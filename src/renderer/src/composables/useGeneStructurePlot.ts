/**
 * D3 v7 gene structure (exon) rendering engine
 *
 * Renders a genomic-level gene structure visualization with:
 * - Horizontal intron line spanning gene start to end
 * - Exon rectangles colored by primary theme color
 * - Exon rank numbers centered in/above exons
 * - Strand direction arrow
 * - Variant lollipop at its genomic position
 * - X-axis with genomic coordinates
 * - D3 zoom behavior
 * - Tooltip data exposed for Vue overlay rendering
 * - SVG/PNG export
 */

import { ref, watchEffect, type Ref } from 'vue'
import * as d3 from 'd3'
import type {
  GeneStructure,
  GeneExon,
  ClinVarVariant,
  ClinVarSignificance
} from '../../../shared/types/protein'
import { CLINVAR_COLORS, getClinVarCategory } from '../../../shared/utils/protein-utils'
import type { Dimensions } from './useResizeObserver'

// ─── Types ────────────────────────────────────────────────────────────────────

/** Tooltip data exposed to Vue for overlay rendering */
export interface GeneStructureTooltipData {
  visible: boolean
  x: number
  y: number
  type: 'exon' | 'variant' | 'clinvar'
  exon?: GeneExon
  variantLabel?: string
  clinvarSignificance?: string
  clinvarVariantId?: string
  clinvarHgvsp?: string | null
}

/** Variant position on the gene structure */
export interface GenomicVariant {
  chr: string
  pos: number
  ref: string
  alt: string
  label: string
  color: string
}

export interface GeneStructurePlotOptions {
  svgRef: Ref<SVGSVGElement | null>
  dimensions: Ref<Dimensions>
  geneStructure: Ref<GeneStructure | null>
  variant: Ref<GenomicVariant | null>
  clinvarVariants?: Ref<ClinVarVariant[]>
  activeClinvarCategories?: Ref<Set<ClinVarSignificance>>
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MARGIN = { top: 50, right: 40, bottom: 70, left: 60 }
const INTRON_Y_OFFSET = 0.45
const EXON_HEIGHT = 28
const INTRON_LINE_WIDTH = 2
const LOLLIPOP_STEM_HEIGHT = 60
const LOLLIPOP_HEAD_RADIUS = 8
const CLINVAR_DIAMOND_SIZE = 7
const CLINVAR_TRACK_OFFSET = 24 // Below the exon track
const EXON_COLOR = '#1867C0' // Vuetify primary blue
const EXON_COLOR_HOVER = '#1565C0'
const INTRON_COLOR = '#9E9E9E'
const VARIANT_COLOR = '#D32F2F' // Red for variant marker

// ─── Composable ───────────────────────────────────────────────────────────────

export function useGeneStructurePlot(options: GeneStructurePlotOptions) {
  const { svgRef, dimensions, geneStructure, variant, clinvarVariants, activeClinvarCategories } =
    options

  const tooltip = ref<GeneStructureTooltipData>({
    visible: false,
    x: 0,
    y: 0,
    type: 'exon'
  })

  const clipId = `gene-structure-clip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  let currentTransform = d3.zoomIdentity
  let zoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown> | null = null

  // ─── Main render function ───────────────────────────────────────────────

  function render(): void {
    const svg = svgRef.value
    if (!svg) return
    const { width, height } = dimensions.value
    if (width <= 0 || height <= 0) return
    const gs = geneStructure.value
    if (!gs) return

    const root = d3.select(svg)
    root.selectAll('*').remove()

    root.attr('width', width).attr('height', height)

    const plotWidth = width - MARGIN.left - MARGIN.right
    const plotHeight = height - MARGIN.top - MARGIN.bottom
    if (plotWidth <= 0 || plotHeight <= 0) return

    // Add a small padding to gene range to avoid exons sitting on edges
    const genePad = Math.max(1, (gs.end - gs.start) * 0.02)
    const xDomain: [number, number] = [gs.start - genePad, gs.end + genePad]

    const xScale = d3.scaleLinear().domain(xDomain).range([0, plotWidth])

    // Main group with margins
    const mainGroup = root.append('g').attr('transform', `translate(${MARGIN.left},${MARGIN.top})`)

    // Clip path
    mainGroup
      .append('defs')
      .append('clipPath')
      .attr('id', clipId)
      .append('rect')
      .attr('x', 0)
      .attr('y', -MARGIN.top)
      .attr('width', plotWidth)
      .attr('height', height)

    const clipGroup = mainGroup.append('g').attr('clip-path', `url(#${clipId})`)

    // Backbone Y position
    const backboneY = plotHeight * INTRON_Y_OFFSET

    // ── Intron line (thin line spanning the whole gene) ──────────────────
    clipGroup
      .append('line')
      .attr('x1', xScale(gs.start))
      .attr('y1', backboneY)
      .attr('x2', xScale(gs.end))
      .attr('y2', backboneY)
      .attr('stroke', INTRON_COLOR)
      .attr('stroke-width', INTRON_LINE_WIDTH)

    // ── Strand direction arrow ──────────────────────────────────────────
    const arrowX = gs.strand === 1 ? xScale(gs.end) + 8 : xScale(gs.start) - 8
    const arrowDir = gs.strand === 1 ? 1 : -1
    const arrowSize = 10
    clipGroup
      .append('path')
      .attr(
        'd',
        `M ${arrowX} ${backboneY} L ${arrowX - arrowDir * arrowSize} ${backboneY - arrowSize / 2} L ${arrowX - arrowDir * arrowSize} ${backboneY + arrowSize / 2} Z`
      )
      .attr('fill', INTRON_COLOR)
      .attr('opacity', 0.6)

    // Strand label
    clipGroup
      .append('text')
      .attr('x', gs.strand === 1 ? xScale(gs.end) + 20 : xScale(gs.start) - 20)
      .attr('y', backboneY + 4)
      .attr('text-anchor', gs.strand === 1 ? 'start' : 'end')
      .attr('fill', '#999')
      .attr('font-size', '11px')
      .text(gs.strand === 1 ? "5' \u2192 3'" : "3' \u2190 5'")

    // ── Exon rectangles ─────────────────────────────────────────────────
    const exonsGroup = clipGroup.append('g').attr('class', 'exons')

    for (const exon of gs.exons) {
      const ex = xScale(exon.start)
      const ew = Math.max(3, xScale(exon.end) - xScale(exon.start))
      const ey = backboneY - EXON_HEIGHT / 2

      // Exon rectangle
      exonsGroup
        .append('rect')
        .attr('x', ex)
        .attr('y', ey)
        .attr('width', ew)
        .attr('height', EXON_HEIGHT)
        .attr('rx', 3)
        .attr('ry', 3)
        .attr('fill', EXON_COLOR)
        .attr('stroke', '#fff')
        .attr('stroke-width', 1)
        .attr('cursor', 'pointer')
        .on('mouseenter', (event: MouseEvent) => {
          d3.select(event.currentTarget as SVGRectElement).attr('fill', EXON_COLOR_HOVER)
          tooltip.value = {
            visible: true,
            x: event.clientX,
            y: event.clientY,
            type: 'exon',
            exon
          }
        })
        .on('mousemove', (event: MouseEvent) => {
          tooltip.value = { ...tooltip.value, x: event.clientX, y: event.clientY }
        })
        .on('mouseleave', (event: MouseEvent) => {
          d3.select(event.currentTarget as SVGRectElement).attr('fill', EXON_COLOR)
          tooltip.value = { ...tooltip.value, visible: false }
        })

      // Exon number label (inside if wide enough, above otherwise)
      const labelText = String(exon.rank)
      const labelFitsInside = ew > 18

      exonsGroup
        .append('text')
        .attr('x', ex + ew / 2)
        .attr('y', labelFitsInside ? backboneY + 4 : ey - 6)
        .attr('text-anchor', 'middle')
        .attr('fill', labelFitsInside ? '#fff' : '#666')
        .attr('font-size', '11px')
        .attr('font-weight', labelFitsInside ? '600' : '400')
        .attr('pointer-events', 'none')
        .text(labelText)
    }

    // ── User variant lollipop ───────────────────────────────────────────
    const v = variant.value
    if (v !== null) {
      const vx = xScale(v.pos)
      const stemTop = backboneY - EXON_HEIGHT / 2 - LOLLIPOP_STEM_HEIGHT
      const variantGroup = clipGroup.append('g').attr('class', 'variant-marker')

      // Stem
      variantGroup
        .append('line')
        .attr('x1', vx)
        .attr('y1', backboneY - EXON_HEIGHT / 2)
        .attr('x2', vx)
        .attr('y2', stemTop)
        .attr('stroke', VARIANT_COLOR)
        .attr('stroke-width', 2.5)

      // Glow ring
      variantGroup
        .append('circle')
        .attr('cx', vx)
        .attr('cy', stemTop)
        .attr('r', LOLLIPOP_HEAD_RADIUS + 3)
        .attr('fill', 'none')
        .attr('stroke', '#FFD700')
        .attr('stroke-width', 2)
        .attr('opacity', 0.4)

      // Head
      variantGroup
        .append('circle')
        .attr('cx', vx)
        .attr('cy', stemTop)
        .attr('r', LOLLIPOP_HEAD_RADIUS)
        .attr('fill', VARIANT_COLOR)
        .attr('stroke', '#FFD700')
        .attr('stroke-width', 2.5)
        .attr('cursor', 'pointer')
        .on('mouseenter', (event: MouseEvent) => {
          tooltip.value = {
            visible: true,
            x: event.clientX,
            y: event.clientY,
            type: 'variant',
            variantLabel: v.label
          }
        })
        .on('mousemove', (event: MouseEvent) => {
          tooltip.value = { ...tooltip.value, x: event.clientX, y: event.clientY }
        })
        .on('mouseleave', () => {
          tooltip.value = { ...tooltip.value, visible: false }
        })

      // Label above head
      variantGroup
        .append('text')
        .attr('x', vx)
        .attr('y', stemTop - LOLLIPOP_HEAD_RADIUS - 8)
        .attr('text-anchor', 'middle')
        .attr('fill', '#333')
        .attr('font-size', '12px')
        .attr('font-weight', '700')
        .text(v.label)
    }

    // ── ClinVar variant diamonds (below exon track) ────────────────────
    const cvVariants = clinvarVariants?.value ?? []
    const activeCategories = activeClinvarCategories?.value ?? new Set()
    if (cvVariants.length > 0) {
      const clinvarGroup = clipGroup.append('g').attr('class', 'clinvar-markers')
      const clinvarY = backboneY + EXON_HEIGHT / 2 + CLINVAR_TRACK_OFFSET

      for (const cv of cvVariants) {
        if (cv.genomicPosition === null) continue
        const cat = getClinVarCategory(cv.clinicalSignificance)
        if (!activeCategories.has(cat)) continue

        const cx = xScale(cv.genomicPosition)
        const color = CLINVAR_COLORS[cat]

        // Diamond shape (rotated square)
        clinvarGroup
          .append('rect')
          .attr('x', cx - CLINVAR_DIAMOND_SIZE / 2)
          .attr('y', clinvarY - CLINVAR_DIAMOND_SIZE / 2)
          .attr('width', CLINVAR_DIAMOND_SIZE)
          .attr('height', CLINVAR_DIAMOND_SIZE)
          .attr('transform', `rotate(45, ${cx}, ${clinvarY})`)
          .attr('fill', color)
          .attr('stroke', '#fff')
          .attr('stroke-width', 0.5)
          .attr('cursor', 'pointer')
          .attr('opacity', 0.85)
          .on('mouseenter', (event: MouseEvent) => {
            d3.select(event.currentTarget as SVGRectElement).attr('opacity', 1)
            tooltip.value = {
              visible: true,
              x: event.clientX,
              y: event.clientY,
              type: 'clinvar',
              clinvarSignificance: cv.clinicalSignificance,
              clinvarVariantId: cv.variantId,
              clinvarHgvsp: cv.hgvsp
            }
          })
          .on('mousemove', (event: MouseEvent) => {
            tooltip.value = { ...tooltip.value, x: event.clientX, y: event.clientY }
          })
          .on('mouseleave', (event: MouseEvent) => {
            d3.select(event.currentTarget as SVGRectElement).attr('opacity', 0.85)
            tooltip.value = { ...tooltip.value, visible: false }
          })
      }
    }

    // ── X-Axis with genomic coordinates ─────────────────────────────────
    const axisY = backboneY + EXON_HEIGHT / 2 + 30

    const xAxis = d3
      .axisBottom(xScale)
      .ticks(Math.min(8, plotWidth / 100))
      .tickFormat((d) => {
        const val = d.valueOf()
        if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(2)} Mb`
        if (val >= 1_000) return `${(val / 1_000).toFixed(1)} kb`
        return String(val)
      })

    const xAxisGroup = mainGroup
      .append('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0,${axisY})`)
      .call(xAxis)

    xAxisGroup.selectAll('text').attr('fill', '#666').attr('font-size', '11px')
    xAxisGroup.selectAll('line').attr('stroke', '#bbb')
    xAxisGroup.selectAll('path').attr('stroke', '#bbb')

    // Axis label
    mainGroup
      .append('text')
      .attr('x', plotWidth / 2)
      .attr('y', axisY + 36)
      .attr('text-anchor', 'middle')
      .attr('fill', '#666')
      .attr('font-size', '12px')
      .text(`Chromosome ${gs.chromosome} (GRCh38)`)

    // ── Title ───────────────────────────────────────────────────────────
    mainGroup
      .append('text')
      .attr('x', plotWidth / 2)
      .attr('y', -20)
      .attr('text-anchor', 'middle')
      .attr('fill', '#333')
      .attr('font-size', '14px')
      .attr('font-weight', '600')
      .text(`${gs.geneSymbol} - ${gs.transcriptId}`)

    // Scale bar
    const geneLength = gs.end - gs.start
    let scaleBarBp: number
    if (geneLength > 100_000) scaleBarBp = 10_000
    else if (geneLength > 10_000) scaleBarBp = 1_000
    else scaleBarBp = 100
    const scaleBarWidth = xScale(gs.start + scaleBarBp) - xScale(gs.start)
    const scaleBarY = axisY + 50

    if (scaleBarY < height - 10) {
      const scaleBarGroup = mainGroup.append('g').attr('class', 'scale-bar')
      scaleBarGroup
        .append('line')
        .attr('x1', 0)
        .attr('y1', scaleBarY)
        .attr('x2', scaleBarWidth)
        .attr('y2', scaleBarY)
        .attr('stroke', '#999')
        .attr('stroke-width', 2)

      // End ticks
      scaleBarGroup
        .append('line')
        .attr('x1', 0)
        .attr('y1', scaleBarY - 3)
        .attr('x2', 0)
        .attr('y2', scaleBarY + 3)
        .attr('stroke', '#999')
        .attr('stroke-width', 2)

      scaleBarGroup
        .append('line')
        .attr('x1', scaleBarWidth)
        .attr('y1', scaleBarY - 3)
        .attr('x2', scaleBarWidth)
        .attr('y2', scaleBarY + 3)
        .attr('stroke', '#999')
        .attr('stroke-width', 2)

      const scaleLabel = scaleBarBp >= 1_000 ? `${scaleBarBp / 1_000} kb` : `${scaleBarBp} bp`
      scaleBarGroup
        .append('text')
        .attr('x', scaleBarWidth / 2)
        .attr('y', scaleBarY - 6)
        .attr('text-anchor', 'middle')
        .attr('fill', '#999')
        .attr('font-size', '11px')
        .text(scaleLabel)
    }

    // ── Zoom behavior ───────────────────────────────────────────────────
    zoomBehavior = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 50])
      .translateExtent([
        [0, 0],
        [width, height]
      ])
      .extent([
        [0, 0],
        [width, height]
      ])
      .on('zoom', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        currentTransform = event.transform
        updateZoom(event.transform)
      })

    root.call(zoomBehavior)

    // Apply current transform if already zoomed
    if (currentTransform.k !== 1) {
      updateZoom(currentTransform)
    }
  }

  // ─── Zoom update function ─────────────────────────────────────────────

  function updateZoom(transform: d3.ZoomTransform): void {
    const svg = svgRef.value
    if (!svg) return
    const gs = geneStructure.value
    if (!gs) return

    const root = d3.select(svg)
    const { width } = dimensions.value
    const plotWidth = width - MARGIN.left - MARGIN.right
    if (plotWidth <= 0) return

    const genePad = Math.max(1, (gs.end - gs.start) * 0.02)
    const xScale = d3
      .scaleLinear()
      .domain([gs.start - genePad, gs.end + genePad])
      .range([0, plotWidth])

    const newXScale = transform.rescaleX(xScale)

    const clipGroup = root.select('g').select('[clip-path]')

    // Update intron line
    clipGroup.select('line').attr('x1', newXScale(gs.start)).attr('x2', newXScale(gs.end))

    // Update exon rects
    clipGroup.selectAll('.exons rect').each(function (_d, i) {
      const exon = gs.exons[i]
      if (exon !== undefined) {
        const ex = newXScale(exon.start)
        const ew = Math.max(3, newXScale(exon.end) - newXScale(exon.start))
        d3.select(this).attr('x', ex).attr('width', ew)
      }
    })

    // Update exon labels
    clipGroup.selectAll('.exons text').each(function (_d, i) {
      const exon = gs.exons[i]
      if (exon !== undefined) {
        const ex = newXScale(exon.start)
        const ew = Math.max(3, newXScale(exon.end) - newXScale(exon.start))
        d3.select(this).attr('x', ex + ew / 2)
      }
    })

    // Update variant marker
    const v = variant.value
    if (v !== null) {
      const vx = newXScale(v.pos)
      clipGroup.selectAll('.variant-marker line').attr('x1', vx).attr('x2', vx)
      clipGroup.selectAll('.variant-marker circle').attr('cx', vx)
      clipGroup.selectAll('.variant-marker text').attr('x', vx)
    }

    // Update ClinVar markers
    const cvVars = clinvarVariants?.value ?? []
    const activeCV = activeClinvarCategories?.value ?? new Set()
    const plotHeight = dimensions.value.height - MARGIN.top - MARGIN.bottom
    const backboneYz = plotHeight * INTRON_Y_OFFSET
    const clinvarYz = backboneYz + EXON_HEIGHT / 2 + CLINVAR_TRACK_OFFSET

    clipGroup.selectAll('.clinvar-markers rect').each(function (_d, i) {
      // Find the i-th visible ClinVar variant
      let visibleIdx = 0
      for (const cv of cvVars) {
        if (cv.genomicPosition === null) continue
        const cat = getClinVarCategory(cv.clinicalSignificance)
        if (!activeCV.has(cat)) continue
        if (visibleIdx === i) {
          const cx = newXScale(cv.genomicPosition)
          d3.select(this)
            .attr('x', cx - CLINVAR_DIAMOND_SIZE / 2)
            .attr('y', clinvarYz - CLINVAR_DIAMOND_SIZE / 2)
            .attr('transform', `rotate(45, ${cx}, ${clinvarYz})`)
          break
        }
        visibleIdx++
      }
    })

    // Update x-axis
    const xAxis = d3
      .axisBottom(newXScale)
      .ticks(Math.min(8, plotWidth / 100))
      .tickFormat((d) => {
        const val = d.valueOf()
        if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(2)} Mb`
        if (val >= 1_000) return `${(val / 1_000).toFixed(1)} kb`
        return String(val)
      })

    root.select('.x-axis').call(xAxis as never)
  }

  // ─── Reactive re-rendering ──────────────────────────────────────────

  watchEffect(() => {
    const _deps = [
      svgRef.value,
      dimensions.value,
      geneStructure.value,
      variant.value,
      clinvarVariants?.value,
      activeClinvarCategories?.value
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
      const scale = 2
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
