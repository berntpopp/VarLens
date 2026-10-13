<template>
  <div ref="plotContainer" style="width: 100%; height: 500px" />
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import {
  buildVolcanoPoints,
  type AssociationPlotRow,
  type PlotPoint
} from '../../utils/association-plot'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Plotly: any = null

const props = defineProps<{
  results: AssociationPlotRow[]
  primaryTest: string
  fdrThreshold?: number
}>()

const plotContainer = ref<HTMLDivElement>()

async function loadPlotly(): Promise<void> {
  if (Plotly !== null) return
  Plotly = await import('plotly.js-basic-dist-min')
}

function trace(points: PlotPoint[], extra: Record<string, unknown>): Record<string, unknown> {
  const marker = extra.marker as Record<string, unknown>
  return {
    ...extra,
    x: points.map((d) => d.x),
    y: points.map((d) => d.y),
    text: points.map((d) => d.gene),
    // Capped effects (infinite or zero odds ratio) sit at the axis edge as a triangle.
    customdata: points.map((d) =>
      d.capped ? `${d.pLabel}<br>effect beyond axis (${d.x > 0 ? 'OR = ∞' : 'OR = 0'})` : d.pLabel
    ),
    type: 'scatter',
    marker: {
      ...marker,
      symbol: points.map((d) =>
        d.capped ? (d.x > 0 ? 'triangle-right' : 'triangle-left') : 'circle'
      )
    },
    hovertemplate: '%{text}<br>x: %{x:.3f}<br>%{customdata}<extra></extra>'
  }
}

function buildPlotData(): Array<Record<string, unknown>> {
  const threshold = props.fdrThreshold ?? 0.05
  const points = buildVolcanoPoints(props.results, props.primaryTest, threshold)
  return [
    trace(
      points.filter((d) => !d.significant),
      { mode: 'markers', name: 'Not significant', marker: { color: '#999', size: 6 } }
    ),
    trace(
      points.filter((d) => d.significant),
      {
        mode: 'markers+text',
        name: `FDR < ${threshold}`,
        marker: { color: '#e53935', size: 8 },
        textposition: 'top center',
        textfont: { size: 10 }
      }
    )
  ]
}

async function render(): Promise<void> {
  if (!plotContainer.value) return
  await loadPlotly()
  if (Plotly === null) return

  const data = buildPlotData()
  const layout = {
    xaxis: {
      title: props.primaryTest === 'fisher' ? 'log2(Odds Ratio)' : '\u03B2 (effect size)'
    },
    yaxis: { title: '-log10(p-value)' },
    hovermode: 'closest',
    showlegend: true,
    margin: { t: 30, l: 60, r: 20, b: 50 }
  }
  Plotly.newPlot(plotContainer.value, data, layout, { responsive: true })
}

watch(() => props.results, render)
onMounted(render)
onBeforeUnmount(() => {
  if (plotContainer.value !== undefined && Plotly !== null) Plotly.purge(plotContainer.value)
})
</script>
