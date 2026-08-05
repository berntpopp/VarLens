#!/usr/bin/env node
// Compares two build-perf baselines and writes a markdown delta report.
// Usage: node scripts/perf/compare-build.mjs <before-label> <after-label>
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'

const REPO_ROOT = resolve(import.meta.dirname, '..', '..')
const OUT_DIR = join(REPO_ROOT, '.planning', 'artifacts', 'perf', 'build')

const round2 = (n) => Math.round(n * 100) / 100
const sum = (stages) => round2(stages.reduce((acc, s) => acc + s.wallSeconds, 0))

// A stage must move more than this to count as a real change; below it, run
// to run jitter dominates. 0.5 s is ~1.5% of the slowest stage in the baseline.
export const NOISE_FLOOR_SECONDS = 0.5

export function compareBaselines(before, after) {
  const afterById = new Map(after.stages.map((s) => [s.id, s]))
  const rows = before.stages.map((b) => {
    const a = afterById.get(b.id)
    if (!a) {
      return {
        id: b.id,
        beforeSeconds: b.wallSeconds,
        afterSeconds: null,
        deltaSeconds: null,
        deltaPercent: null,
        classification: 'missing'
      }
    }
    const deltaSeconds = round2(a.wallSeconds - b.wallSeconds)
    const deltaPercent = b.wallSeconds === 0 ? null : round2((deltaSeconds / b.wallSeconds) * 100)
    let classification = 'unchanged'
    if (Math.abs(deltaSeconds) > NOISE_FLOOR_SECONDS) {
      classification = deltaSeconds < 0 ? 'improved' : 'regressed'
    }
    return {
      id: b.id,
      beforeSeconds: b.wallSeconds,
      afterSeconds: a.wallSeconds,
      deltaSeconds,
      deltaPercent,
      classification,
      beforePeakRssMb: b.peakRssMb,
      afterPeakRssMb: a.peakRssMb
    }
  })

  // Stages present only in `after` are new coverage, not a delta.
  for (const a of after.stages) {
    if (!before.stages.some((b) => b.id === a.id)) {
      rows.push({
        id: a.id,
        beforeSeconds: null,
        afterSeconds: a.wallSeconds,
        deltaSeconds: null,
        deltaPercent: null,
        classification: 'new',
        beforePeakRssMb: null,
        afterPeakRssMb: a.peakRssMb
      })
    }
  }

  return { rows, totalBefore: sum(before.stages), totalAfter: sum(after.stages) }
}

const cell = (v, suffix = '') => (v === null || v === undefined ? '—' : `${v}${suffix}`)

export function formatReport(comparison, meta) {
  const lines = [
    `# Build performance: ${meta.before} → ${meta.after}`,
    '',
    `Total measured wall clock: **${comparison.totalBefore}s → ${comparison.totalAfter}s** ` +
      `(${round2(comparison.totalAfter - comparison.totalBefore)}s)`,
    '',
    '| Stage | Before (s) | After (s) | Δ (s) | Δ (%) | Peak RSS before → after (MB) | Verdict |',
    '|---|---:|---:|---:|---:|---:|---|'
  ]
  for (const r of comparison.rows) {
    lines.push(
      `| \`${r.id}\` | ${cell(r.beforeSeconds)} | ${cell(r.afterSeconds)} | ${cell(r.deltaSeconds)} | ` +
        `${cell(r.deltaPercent, '%')} | ${cell(r.beforePeakRssMb)} → ${cell(r.afterPeakRssMb)} | ${r.classification} |`
    )
  }
  const regressions = comparison.rows.filter((r) => r.classification === 'regressed')
  lines.push(
    '',
    regressions.length === 0
      ? 'No stage regressed beyond the noise floor.'
      : `**Regressions:** ${regressions.map((r) => r.id).join(', ')}`
  )
  return `${lines.join('\n')}\n`
}

function main() {
  const [beforeLabel, afterLabel] = process.argv.slice(2)
  if (!beforeLabel || !afterLabel) {
    process.stdout.write('usage: compare-build.mjs <before-label> <after-label>\n')
    process.exit(2)
  }
  const read = (label) => JSON.parse(readFileSync(join(OUT_DIR, `${label}.json`), 'utf8'))
  const comparison = compareBaselines(read(beforeLabel), read(afterLabel))
  const md = formatReport(comparison, { before: beforeLabel, after: afterLabel })
  const outFile = join(OUT_DIR, `compare-${beforeLabel}-to-${afterLabel}.md`)
  writeFileSync(outFile, md)
  process.stdout.write(`${md}\nwrote ${outFile}\n`)
}

if (process.argv[1] === import.meta.filename) main()
