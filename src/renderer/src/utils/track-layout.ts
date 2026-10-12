/**
 * Layout rules of the track plots (pure): domain lanes that never overlap,
 * labels that fit or are dropped instead of colliding, and genomic tick
 * labels precise enough never to repeat (#571).
 */

/** Lane per feature: overlapping features stack, a lane is reused once free. */
export function assignLanes(
  features: Array<{ key: string; start: number; end: number }>
): Map<string, number> {
  const laneEnds: number[] = []
  const lanes = new Map<string, number>()
  for (const f of [...features].sort((a, b) => a.start - b.start)) {
    let lane = laneEnds.findIndex((end) => end < f.start)
    if (lane === -1) lane = laneEnds.length
    laneEnds[lane] = f.end
    lanes.set(f.key, lane)
  }
  return lanes
}

/** The label cut to `px` (with an ellipsis), or '' when not even 3 characters fit. */
export function fitLabel(text: string, px: number, charPx: number): string {
  const max = Math.floor((px - 4) / charPx)
  if (max >= text.length) return text
  return max < 3 ? '' : `${text.slice(0, max - 1)}…`
}

/** Keys of the labels to draw, left to right, each at least `gap` px from the last drawn one. */
export function placeLabels(
  items: Array<{ key: string; x: number; width: number }>,
  gap: number
): string[] {
  const shown: string[] = []
  let right = -Infinity
  for (const item of [...items].sort((a, b) => a.x - b.x)) {
    if (item.x - item.width / 2 < right + gap) continue
    shown.push(item.key)
    right = item.x + item.width / 2
  }
  return shown
}

/** Genomic tick labels: Mb with as many decimals as the tick step needs, else plain bp. */
export function genomicTickLabels(ticks: number[]): string[] {
  const step = Math.min(...ticks.slice(1).map((t, i) => t - ticks[i]))
  if (Math.max(...ticks) >= 1_000_000 && step >= 1_000) {
    const decimals = Math.max(0, Math.ceil(-Math.log10(step / 1_000_000) - 1e-9))
    return ticks.map((t) => `${(t / 1_000_000).toFixed(decimals)} Mb`)
  }
  return ticks.map((t) => t.toLocaleString('en-US'))
}
