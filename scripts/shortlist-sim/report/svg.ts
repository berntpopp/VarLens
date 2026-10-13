// Self-contained SVG charts for the report (reference dataviz palette; light and dark
// via prefers-color-scheme inside the SVG; native <title> tooltips on every mark).

const LIGHT = [
  '#2a78d6',
  '#eb6834',
  '#1baf7a',
  '#eda100',
  '#e87ba4',
  '#008300',
  '#6250d6',
  '#e34948'
]
const DARK = [
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#008300',
  '#9085e9',
  '#e66767'
]
export const MAX_SERIES = LIGHT.length

// Plain class rules (no CSS custom properties) so non-browser renderers draw them too.
const theme = (
  t: { surface: string; ink: string; ink2: string; muted: string; grid: string; axis: string },
  series: string[]
): string =>
  `.bg{fill:${t.surface}}text{fill:${t.ink2}}.title{fill:${t.ink}}.muted{fill:${t.muted}}` +
  `.grid{stroke:${t.grid}}.axis{stroke:${t.axis}}.ci{stroke:${t.ink2}}` +
  series.map((c, i) => `.s${i + 1}{stroke:${c}}.f${i + 1}{fill:${c}}`).join('')

const STYLE = `<style>
text{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:12px;font-variant-numeric:tabular-nums}
.grid,.axis{stroke-width:1}.title{font-size:14px;font-weight:600}.ci{stroke-width:1.5}
.line{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}.hit{fill:none;stroke:transparent;stroke-width:12}
${theme({ surface: '#fcfcfb', ink: '#0b0b0b', ink2: '#52514e', muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7' }, LIGHT)}
@media (prefers-color-scheme:dark){${theme({ surface: '#1a1a19', ink: '#f0efec', ink2: '#c3c2b7', muted: '#898781', grid: '#2c2c2a', axis: '#383835' }, DARK)}}
</style>`

export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const n2 = (v: number): string => (Math.round(v * 100) / 100).toString()
const pct = (v: number): string => `${(v * 100).toFixed(1)} %`

function frame(width: number, height: number, title: string, desc: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="t d">
<title id="t">${esc(title)}</title><desc id="d">${esc(desc)}</desc>${STYLE}
<rect class="bg" width="${width}" height="${height}" rx="8"/>
<text class="title" x="16" y="24">${esc(title)}</text>
${body}</svg>
`
}

export interface CdfSeries {
  label: string
  points: Array<{ k: number; share: number }>
}

/** Share of cases with rank ≤ k on a log10 rank axis; one 2px line per scorer (≤ 8). */
export function rankCdfSvg(series: CdfSeries[], title = 'Rank CDF, primary scenario'): string {
  const shown = series.slice(0, MAX_SERIES)
  const ks = shown.flatMap((s) => s.points.map((p) => p.k))
  const kMax = Math.max(10, ...ks)
  const W = 720
  const legendRows = Math.ceil(shown.length / 3)
  const top = 40 + legendRows * 18 + 8
  const H = top + 260 + 44
  const L = 56
  const R = W - 24
  const B = top + 260
  const x = (k: number): number => L + (Math.log10(k) / Math.log10(kMax)) * (R - L)
  const y = (v: number): number => B - v * (B - top)
  const parts: string[] = []
  for (const v of [0, 0.25, 0.5, 0.75, 1]) {
    parts.push(`<line class="grid" x1="${L}" x2="${R}" y1="${n2(y(v))}" y2="${n2(y(v))}"/>`)
    parts.push(`<text x="${L - 8}" y="${n2(y(v) + 4)}" text-anchor="end">${v * 100}%</text>`)
  }
  const ticks = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000].filter(
    (k) => k <= kMax
  )
  for (const k of ticks) {
    parts.push(`<text x="${n2(x(k))}" y="${B + 18}" text-anchor="middle">${k}</text>`)
  }
  parts.push(`<line class="axis" x1="${L}" x2="${R}" y1="${B}" y2="${B}"/>`)
  parts.push(
    `<text class="muted" x="${(L + R) / 2}" y="${B + 36}" text-anchor="middle">Case rank (log scale; compound het = worse allele)</text>`
  )
  shown.forEach((s, i) => {
    const col = 16 + (i % 3) * 230
    const row = 40 + Math.floor(i / 3) * 18
    parts.push(
      `<line class="line s${i + 1}" x1="${col}" x2="${col + 16}" y1="${row}" y2="${row}"/>`
    )
    parts.push(`<text x="${col + 22}" y="${row + 4}">${esc(s.label)}</text>`)
    const d = s.points
      .filter((p) => Number.isFinite(p.share))
      .map((p, j) => `${j === 0 ? 'M' : 'L'}${n2(x(p.k))},${n2(y(p.share))}`)
      .join('')
    const tip = `${s.label}: ${s.points.map((p) => `≤${p.k} ${pct(p.share)}`).join(', ')}`
    parts.push(
      `<g><title>${esc(tip)}</title><path class="line s${i + 1}" d="${d}"/><path class="hit" d="${d}"/></g>`
    )
  })
  const desc = `Cumulative share of cases found within each rank for ${shown.length} scorers${series.length > shown.length ? ` (first ${MAX_SERIES} of ${series.length}; all are in the tables)` : ''}.`
  return frame(W, H, title, desc, parts.join('\n'))
}

export interface IntervalBar {
  label: string
  estimate: number
  lo: number
  hi: number
}

/** Horizontal bars (share 0–1) with 95 % interval whiskers, one row per scorer. */
export function hitBarsSvg(
  rows: IntervalBar[],
  title = 'Hit@10 (macro over consequence classes) with 95 % CI'
): string {
  const W = 720
  const L = 220
  const R = W - 80
  const top = 44
  const band = 30
  const H = top + rows.length * band + 40
  const x = (v: number): number => L + Math.min(Math.max(v, 0), 1) * (R - L)
  const parts: string[] = []
  for (const v of [0, 0.25, 0.5, 0.75, 1]) {
    parts.push(
      `<line class="grid" x1="${n2(x(v))}" x2="${n2(x(v))}" y1="${top - 4}" y2="${top + rows.length * band}"/>`
    )
    parts.push(
      `<text x="${n2(x(v))}" y="${top + rows.length * band + 16}" text-anchor="middle">${v * 100}%</text>`
    )
  }
  rows.forEach((r, i) => {
    const cy = top + i * band + band / 2
    const x0 = x(0)
    const x1 = x(Number.isFinite(r.estimate) ? r.estimate : 0)
    const h = 16
    const rr = Math.min(4, Math.max(0, x1 - x0))
    // Square at the baseline, 4px rounded data end.
    const bar = `M${n2(x0)},${n2(cy - h / 2)}H${n2(x1 - rr)}Q${n2(x1)},${n2(cy - h / 2)} ${n2(x1)},${n2(cy - h / 2 + rr)}V${n2(cy + h / 2 - rr)}Q${n2(x1)},${n2(cy + h / 2)} ${n2(x1 - rr)},${n2(cy + h / 2)}H${n2(x0)}Z`
    const tip = `${r.label}: ${pct(r.estimate)} [${pct(r.lo)}, ${pct(r.hi)}]`
    parts.push(`<text x="${L - 10}" y="${n2(cy + 4)}" text-anchor="end">${esc(r.label)}</text>`)
    const whisker =
      Number.isFinite(r.lo) && Number.isFinite(r.hi)
        ? `<line class="ci" x1="${n2(x(r.lo))}" x2="${n2(x(r.hi))}" y1="${n2(cy)}" y2="${n2(cy)}"/><line class="ci" x1="${n2(x(r.lo))}" x2="${n2(x(r.lo))}" y1="${n2(cy - 5)}" y2="${n2(cy + 5)}"/><line class="ci" x1="${n2(x(r.hi))}" x2="${n2(x(r.hi))}" y1="${n2(cy - 5)}" y2="${n2(cy + 5)}"/>`
        : ''
    const labelX = Math.max(x1, Number.isFinite(r.hi) ? x(r.hi) : x1) + 8
    parts.push(
      `<g><title>${esc(tip)}</title><path class="f1" d="${bar}"/>${whisker}<rect x="${L}" y="${n2(cy - band / 2)}" width="${R - L}" height="${band}" fill="transparent"/></g>`
    )
    parts.push(`<text x="${n2(labelX)}" y="${n2(cy + 4)}">${pct(r.estimate)}</text>`)
  })
  parts.push(
    `<line class="axis" x1="${L}" x2="${L}" y1="${top - 4}" y2="${top + rows.length * band}"/>`
  )
  return frame(
    W,
    H,
    title,
    `${rows.length} scorers; bar = point estimate, whisker = 95 % gene-cluster bootstrap interval.`,
    parts.join('\n')
  )
}
