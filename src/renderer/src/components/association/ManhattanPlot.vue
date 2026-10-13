<template>
  <div ref="plotContainer" style="width: 100%; height: 500px" />
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { buildManhattanPoints, type AssociationPlotRow } from '../../utils/association-plot'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Plotly: any = null

const props = defineProps<{
  results: AssociationPlotRow[]
  primaryTest: string
  genePositions?: Map<string, { chr: string; pos: number }>
}>()

const plotContainer = ref<HTMLDivElement>()

const CHR_COLORS = ['#1f77b4', '#aec7e8']

async function loadPlotly(): Promise<void> {
  if (Plotly !== null) return
  Plotly = await import('plotly.js-basic-dist-min')
}

async function render(): Promise<void> {
  if (!plotContainer.value) return
  await loadPlotly()
  if (Plotly === null) return

  const genesWithP = buildManhattanPoints(props.results, props.primaryTest)
  const x = genesWithP.map((g) => g.x)
  const y = genesWithP.map((g) => g.y)
  const text = genesWithP.map((g) => g.gene)
  const colors = genesWithP.map((g, i) => (g.significant ? '#e53935' : CHR_COLORS[i % 2]))

  const bonferroniLine = genesWithP.length > 0 ? -Math.log10(0.05 / genesWithP.length) : 5

  const data = [
    {
      x,
      y,
      text,
      customdata: genesWithP.map((g) => g.pLabel),
      mode: 'markers',
      type: 'scatter',
      marker: { color: colors, size: 6 },
      hovertemplate: '%{text}<br>-log10(p): %{y:.2f}<br>%{customdata}<extra></extra>'
    }
  ]

  const layout = {
    xaxis: {
      title: 'Gene index',
      showticklabels: false
    },
    yaxis: { title: '-log10(p-value)' },
    shapes: [
      {
        type: 'line',
        x0: 0,
        x1: genesWithP.length,
        y0: bonferroniLine,
        y1: bonferroniLine,
        line: { color: 'red', width: 1, dash: 'dash' }
      },
      {
        type: 'line',
        x0: 0,
        x1: genesWithP.length,
        y0: -Math.log10(0.05),
        y1: -Math.log10(0.05),
        line: { color: 'blue', width: 1, dash: 'dot' }
      }
    ],
    annotations: [
      {
        x: genesWithP.length,
        y: bonferroniLine,
        text: 'Bonferroni',
        showarrow: false,
        xanchor: 'right',
        font: { size: 10, color: 'red' }
      }
    ],
    hovermode: 'closest',
    showlegend: false,
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
