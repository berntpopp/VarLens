/**
 * Lighthouse gate on the built web app (desktop preset, median of N runs):
 * Performance >= 95, Accessibility 100, Best Practices 100, CLS <= 0.02 per
 * cold navigation; CLS <= 0.02 per interaction timespan; A11y/BP 100 per
 * state snapshot. The mobile preset is recorded only (not gating) for now.
 */
import { mkdirSync, writeFileSync } from 'fs'
import { expect, test } from '@playwright/test'
import {
  DESKTOP_BUDGETS,
  evaluateBudgets,
  formatResultTable,
  gateFailures,
  recordStepMetrics,
  type FlowStepLike
} from '../../scripts/ui-gates/lighthouse-budgets'
import { GATE_OUTPUT_DIR, readGateState, writeJson } from './support/gate-state'
import { KNOWN_FAILURES } from './support/known-failures'
import { runLighthouseFlow, type LighthousePreset } from './support/lighthouse-flow'

const RUNS = Math.max(1, Number(process.env.UI_GATES_LH_RUNS ?? '3'))
const OUT = `${GATE_OUTPUT_DIR}/lighthouse`

async function collect(preset: LighthousePreset, runs: number): Promise<FlowStepLike[][]> {
  mkdirSync(OUT, { recursive: true })
  const state = readGateState()
  const collected: FlowStepLike[][] = []
  for (let index = 0; index < runs; index += 1) {
    const run = await runLighthouseFlow(state, preset)
    if (index === 0) writeFileSync(`${OUT}/${preset}-flow.report.html`, run.html)
    collected.push(run.steps)
  }
  writeJson(
    `${OUT}/${preset}-metrics.json`,
    collected.map((steps) =>
      Object.fromEntries(steps.map((step) => [step.name, recordStepMetrics(step)]))
    )
  )
  return collected
}

test.describe.serial('lighthouse', () => {
  test.setTimeout(20 * 60_000)

  test(`desktop budgets (median of ${RUNS} runs)`, async () => {
    const runs = await collect('desktop', RUNS)
    const results = evaluateBudgets(runs, DESKTOP_BUDGETS, KNOWN_FAILURES)
    writeJson(`${OUT}/desktop-budgets.json`, results)
    writeFileSync(`${OUT}/desktop-budgets.md`, `${formatResultTable(results)}\n`)
    test.info().annotations.push({ type: 'budgets', description: formatResultTable(results) })
    expect(gateFailures(results), formatResultTable(results)).toEqual([])
  })

  test('mobile (recorded only, not gated)', async () => {
    const runs = await collect('mobile', 1)
    const results = evaluateBudgets(runs, DESKTOP_BUDGETS, {})
    writeFileSync(`${OUT}/mobile-recorded.md`, `${formatResultTable(results)}\n`)
    expect(runs[0].length).toBeGreaterThan(0)
  })
})
