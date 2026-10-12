/**
 * What the two views draw: the variant of interest (star, or a CNV/SV band,
 * #539), labelled tracks, readable domains and a gene axis whose ticks and
 * exon numbers never repeat or collide (#571).
 */
import { describe, expect, it } from 'vitest'
import * as d3 from 'd3'

import { drawGeneView } from '../../../../src/renderer/src/composables/track-plot/gene-view'
import { drawProteinView } from '../../../../src/renderer/src/composables/track-plot/lollipop-view'
import type { TrackDrawContext } from '../../../../src/renderer/src/composables/track-plot/useTrackPlot'
import {
  TRACK_GUTTER_PX,
  TRACK_LABELS
} from '../../../../src/renderer/src/config/proteinPlotConfig'
import type { TrackMarker, TrackWindow } from '../../../../src/renderer/src/utils/track-window'

function context(window: TrackWindow, markers: TrackMarker[], width = 1000): TrackDrawContext {
  const svg = d3.select(document.body).append('svg') as d3.Selection<
    SVGSVGElement,
    unknown,
    null,
    undefined
  >
  const plotWidth = width - TRACK_GUTTER_PX - 16
  return {
    root: svg,
    width,
    height: 360,
    plotWidth,
    x: d3.scaleLinear().domain([window.start, window.end]).range([0, plotWidth]),
    window,
    markers,
    highlighted: new Set(),
    focusedKey: null,
    bindMarker: (el, m) => void el.attr('data-key', m.key),
    bindFeature: () => undefined
  }
}

const marker = (over: Partial<TrackMarker>): TrackMarker => ({
  key: 'a',
  position: 180,
  track: 'variant',
  label: 'p.Met180Val',
  weight: 1,
  color: '#008000',
  ...over
})

const texts = (ctx: TrackDrawContext): string[] =>
  [...ctx.root.node()!.querySelectorAll('text')].map((t) => t.textContent ?? '')

describe('protein view', () => {
  it('labels every track, names the domain and marks the variant of interest with a star', () => {
    const ctx = context({ start: 0, end: 683 }, [
      marker({ isAnchor: true }),
      marker({ key: 'cv', position: 200, track: 'clinvar', label: 'p.Arg200Gln' })
    ])
    drawProteinView(ctx, {
      clipId: 'c',
      length: 683,
      features: [
        { key: 'd', name: 'THO complex subunit 5', start: 100, end: 400, color: '#7B1FA2' }
      ],
      cohort: false,
      hasClinvar: true,
      showGnomad: false
    })
    const all = texts(ctx)
    for (const label of [TRACK_LABELS.variant, TRACK_LABELS.domains, TRACK_LABELS.clinvar]) {
      expect(all).toContain(label)
    }
    expect(all).toContain('THO complex subunit 5')
    expect(all).toContain('p.Met180Val')
    expect(ctx.root.node()!.querySelector('.is-anchor path')).not.toBeNull()
    expect(all).toContain('Amino-acid position')
  })
})

describe('gene view', () => {
  const exons = Array.from({ length: 60 }, (_, i) => ({
    start: 29_500_000 + i * 900,
    end: 29_500_000 + i * 900 + 120,
    rank: i + 1
  }))
  const gene = {
    geneSymbol: 'TTNX',
    chromosome: '22',
    start: 29_500_000,
    end: 29_554_000,
    strand: 1 as const,
    transcriptId: 'TTNX-201',
    exons
  }
  const model = (anchorVariant: Parameters<typeof drawGeneView>[1]['anchorVariant']) => ({
    clipId: 'g',
    gene,
    anchorVariant,
    axisNote: null,
    cohort: false,
    hasClinvar: false
  })

  it('a 60-exon gene: no repeated tick labels and no colliding exon numbers (#571)', () => {
    const ctx = context({ start: gene.start, end: gene.end }, [], 900)
    drawGeneView(ctx, model(null))
    const svg = ctx.root.node()!
    const ticks = [...svg.querySelectorAll('text')]
      .map((t) => t.textContent ?? '')
      .filter((t) => t.endsWith('Mb'))
    expect(ticks.length).toBeGreaterThan(2)
    expect(new Set(ticks).size).toBe(ticks.length)
    const exonLabels = [...svg.querySelectorAll('text')]
      .filter((t) => /^\d+$/.test(t.textContent ?? ''))
      .map((t) => ({ x: Number(t.getAttribute('x')), chars: (t.textContent ?? '').length }))
    expect(exonLabels.length).toBeGreaterThan(5)
    expect(exonLabels.length).toBeLessThan(60)
    // ~7 px per digit: neighbouring numbers never touch.
    exonLabels.slice(1).forEach((l, i) => {
      const prev = exonLabels[i]
      expect(l.x - prev.x).toBeGreaterThanOrEqual(3.5 * (l.chars + prev.chars))
    })
  })

  it('a deletion is a band from POS to END over the exons it hits (#539)', () => {
    const del = {
      chr: '22',
      pos: 29_510_000,
      end: 29_520_000,
      ref: 'N',
      alt: '<DEL>',
      label: 'DEL',
      color: '#D32F2F'
    }
    const ctx = context({ start: gene.start, end: gene.end }, [
      marker({ key: 'anchor', position: del.pos, isAnchor: true, label: 'DEL' })
    ])
    drawGeneView(ctx, model(del))
    const band = ctx.root.node()!.querySelector('.is-anchor rect')!
    expect(Number(band.getAttribute('x'))).toBeCloseTo(ctx.x(del.pos))
    expect(Number(band.getAttribute('width'))).toBeCloseTo(ctx.x(del.end) - ctx.x(del.pos))
    expect(texts(ctx)).toContain('DEL')
  })

  it('a point variant is the star at POS', () => {
    const snv = {
      chr: '22',
      pos: 29_539_391,
      ref: 'T',
      alt: 'C',
      label: 'p.Met180Val',
      color: '#D32F2F'
    }
    const ctx = context({ start: gene.start, end: gene.end }, [
      marker({ key: 'anchor', position: snv.pos, isAnchor: true })
    ])
    drawGeneView(ctx, model(snv))
    expect(ctx.root.node()!.querySelector('.is-anchor path')).not.toBeNull()
    expect(ctx.root.node()!.querySelector('.is-anchor rect')).toBeNull()
  })
})
