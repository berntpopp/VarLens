/**
 * Accessibility gate: axe-core (WCAG 2.0/2.1/2.2 A + AA) on the five key
 * states of the built web app, in light AND dark theme. Any serious or
 * critical violation fails the gate. Moderate/minor findings are recorded in
 * the JSON summary but do not fail.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { applyTheme, GATE_STATES, gotoState, type GateTheme } from './support/app-states'
import { GATE_OUTPUT_DIR, GATE_STORAGE_STATE_PATH, writeJson } from './support/gate-state'
import { expectedFailureFor } from './support/known-failures'

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const BLOCKING_IMPACTS = new Set(['serious', 'critical'])
const THEMES: readonly GateTheme[] = ['light', 'dark']

for (const theme of THEMES) {
  for (const state of GATE_STATES) {
    test.describe(`axe ${theme} theme`, () => {
      test.use({ storageState: state === 'login' ? undefined : GATE_STORAGE_STATE_PATH })

      test(`${state}: 0 serious/critical violations`, async ({ page }) => {
        const known = expectedFailureFor(`axe:${theme}:${state}`)
        if (known !== undefined) {
          test.info().annotations.push({ type: 'expected-fail', description: known })
          test.fail()
        }

        await gotoState(page, state)
        await applyTheme(page, theme)

        const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
        const summary = results.violations.map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          help: violation.help,
          nodes: violation.nodes.length,
          targets: violation.nodes.slice(0, 5).map((node) => node.target.join(' ')),
          details: violation.nodes
            .slice(0, 5)
            .map((node) => node.any[0]?.message ?? node.failureSummary)
        }))
        writeJson(`${GATE_OUTPUT_DIR}/axe/${theme}-${state}.json`, {
          url: page.url(),
          passes: results.passes.length,
          incomplete: results.incomplete.length,
          violations: summary
        })

        const blocking = summary.filter((v) => BLOCKING_IMPACTS.has(v.impact ?? ''))
        expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([])
      })
    })
  }
}
