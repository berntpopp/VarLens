/* Run from the repository root after `make ui-gates-build`.
 * Uses only a disposable schema and synthetic fixtures; never saves credentials.
 * This is an audit reproducer, not an application or test-suite change.
 */
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      esModuleInterop: true }
  }).outputText, filename)
}
const { startGateServer, stopGateServer } = require('../../../tests/ui-gates/support/gate-server.ts')
const { gotoState, applyTheme, settle } = require('../../../tests/ui-gates/support/app-states.ts')
const { buildStorageState } = require('../../../tests/ui-gates/support/gate-state.ts')
const { chromium } = require('@playwright/test')
const AxeBuilder = require('@axe-core/playwright').default
const OUT = path.resolve('.planning/artifacts/filtering-ux-audit-2026-10-10')

async function setup() {
  if (!process.env.VARLENS_PG_URL && fs.existsSync('.env.postgres.local')) process.loadEnvFile('.env.postgres.local')
  process.env.UI_GATES_SCHEMA_PREFIX = 'filter_audit'
  const state = await startGateServer()
  let browser
  try {
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({ baseURL: state.baseURL,
      viewport: { width: 1440, height: 900 }, storageState: buildStorageState(state) })
    const page = await context.newPage()
    page.setDefaultTimeout(15000)
    fs.mkdirSync(OUT, { recursive: true })
    return { state, browser, context, page, out: OUT }
  } catch (error) {
    await browser?.close()
    await stopGateServer(state)
    throw error
  }
}
async function close(audit) {
  try { await audit.browser.close() } finally { await stopGateServer(audit.state) }
}
async function capture(audit, name) {
  await settle(audit.page)
  assert.equal(await audit.page.locator('.v-skeleton-loader:visible').count(), 0)
  assert.equal(await audit.page.locator('.v-progress-linear--indeterminate:visible').count(), 0)
  await audit.page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true })
}
async function baseline(audit) {
  const results = []
  for (const theme of ['light', 'dark']) {
    for (const state of ['home', 'case-table', 'case-details-panel', 'cohort']) {
      await gotoState(audit.page, state)
      await applyTheme(audit.page, theme)
      await capture(audit, `${theme}-${state}`)
      const axe = await new AxeBuilder({ page: audit.page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
      results.push({ theme, state, passes: axe.passes.length, incomplete: axe.incomplete.length,
        violations: axe.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help,
          targets: v.nodes.map(n => n.target), details: v.nodes.map(n => n.failureSummary) })) })
      fs.writeFileSync(path.join(OUT, 'browser-baseline.json'), JSON.stringify(results, null, 2) + '\n')
      process.stdout.write(`${theme}/${state}: ${axe.violations.length} axe violations\n`)
    }
  }
  return results
}
module.exports = { setup, close, capture, baseline, gotoState, applyTheme, settle, OUT }
if (require.main === module) {
  ;(async () => {
    const audit = await setup()
    try { await baseline(audit) } finally { await close(audit) }
  })().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1 })
}
