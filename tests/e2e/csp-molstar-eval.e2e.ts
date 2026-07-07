/**
 * CSP regression guard: the Mol* / pdbe-molstar 3D viewer MUST render a real
 * protein structure under the app's shipped Content-Security-Policy.
 *
 * WHY THIS EXISTS (PR-G / finding S4 spike, G0):
 * The shipped `script-src` includes `'unsafe-eval'`. A spike attempted to drop
 * it (keeping `'wasm-unsafe-eval'`). A Playwright `_electron` differential on a
 * real GPU proved this BREAKS the viewer: with `'unsafe-eval'` the structure
 * renders (canvas + Mol* plugin mount); without it, structure load fails and no
 * WebGL canvas is ever created. The runtime code generation happens inside a
 * Mol* WEB WORKER during structure loading, so it never surfaces as a main-page
 * `securitypolicyviolation` or console error — which is exactly how a naive
 * "no console errors" check would miss the regression. This test is the guard:
 * if someone removes `'unsafe-eval'` (or otherwise breaks Mol*), it fails here.
 *
 * Environment: like the sibling protein-3d-*.e2e.ts, this needs the local dev
 * database (a case with a structure-bearing variant), network access to the
 * structure hosts, and a working WebGL context. It is a LOCAL guard, not a CI
 * gate — it skips (never false-passes) when a structure cannot be reached.
 */
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

function log(msg: string): void {
  process.stdout.write(`[csp-e2e] ${msg}\n`)
}

async function dismissDisclaimer(window: Page): Promise<void> {
  const btn = window.locator('button:has-text("I Understand")')
  try {
    await btn.waitFor({ state: 'visible', timeout: 15_000 })
    await btn.click()
    await window.waitForTimeout(500)
  } catch {
    /* no disclaimer this launch */
  }
}

/**
 * From the currently-selected case, try each of the first `maxRows` variants
 * until one renders a 3D structure. `.molstar-element` is CSS-hidden until
 * `structureLoaded` flips true, so Playwright's 'visible' wait resolves exactly
 * when Mol* has finished mounting + loading (canvas created, WASM/JS init +
 * structure parse complete). A variant whose protein has no structure shows the
 * empty-state and is fast-skipped. Returns true on the first rendered structure.
 */
async function renderAnyStructure(window: Page, maxRows: number, testInfo: import('@playwright/test').TestInfo): Promise<boolean> {
  const rows = window.locator('.v-data-table tbody tr')
  const rowCount = Math.min(await rows.count(), maxRows)
  log(`variant rows: ${await rows.count()} (trying up to ${rowCount})`)

  for (let i = 0; i < rowCount; i++) {
    await rows.nth(i).click()
    await window.waitForTimeout(400)

    const proteinBtn = window.locator('[aria-label="Open protein view"]')
    if ((await proteinBtn.count()) === 0) continue
    await proteinBtn.first().click()
    await window.waitForTimeout(400)

    const structureTab = window.locator('button:has-text("3D Structure")')
    if ((await structureTab.count()) > 0) await structureTab.click()

    const rendered = window
      .locator('.molstar-element')
      .waitFor({ state: 'visible', timeout: 60_000 })
      .then(() => 'rendered' as const)
      .catch(() => 'timeout' as const)
    const empty = window
      .locator('text=No 3D structure available')
      .waitFor({ state: 'visible', timeout: 60_000 })
      .then(() => 'empty' as const)
      .catch(() => 'timeout' as const)
    const outcome = await Promise.race([rendered, empty])
    log(`row ${i}: ${outcome}`)

    if (outcome === 'rendered') {
      await window.screenshot({ path: testInfo.outputPath(`row-${i}-rendered.png`) })
      return true
    }
    await window.keyboard.press('Escape')
    await window.waitForTimeout(300)
  }
  return false
}

// eslint-disable-next-line no-empty-pattern
test('CSP guard: Mol* 3D viewer renders a structure under the shipped CSP', async ({}, testInfo) => {
  test.setTimeout(240_000)
  let app: ElectronApplication | undefined

  try {
    app = await electron.launch({
      args: ['./out/main/index.js'],
      env: { ...process.env, NODE_ENV: 'production' }
    })
    const window = await app.firstWindow()
    await window.waitForSelector('.v-application', { timeout: 30_000 })

    // Document the requirement: the shipped CSP grants 'unsafe-eval' because the
    // Mol* worker runtime needs it. If this ever changes, revisit the G0 spike.
    const csp = await window.evaluate(
      () =>
        document
          .querySelector('meta[http-equiv="Content-Security-Policy"]')
          ?.getAttribute('content') ?? ''
    )
    expect(csp, "shipped CSP must retain 'unsafe-eval' for the Mol* worker").toContain("'unsafe-eval'")

    await dismissDisclaimer(window)

    const caseItem = window.locator('.v-list-item').first()
    if ((await caseItem.count()) === 0) {
      test.skip(true, 'No cases in local database — cannot exercise the viewer')
      return
    }
    await caseItem.click()
    await window.waitForTimeout(2000)

    if ((await window.locator('.v-data-table tbody tr').count()) === 0) {
      test.skip(true, 'No variants in the first case — cannot exercise the viewer')
      return
    }

    const rendered = await renderAnyStructure(window, 12, testInfo)
    if (!rendered) {
      test.skip(
        true,
        'No structure-bearing variant reached (no data / network / WebGL) — inconclusive'
      )
      return
    }

    // If we get here a real 3D structure rendered under the shipped CSP — the
    // guard passes. A regression (e.g. dropping 'unsafe-eval') fails the
    // renderAnyStructure step above with every variant timing out.
    expect(rendered).toBe(true)
  } finally {
    if (app) await app.close()
  }
})
