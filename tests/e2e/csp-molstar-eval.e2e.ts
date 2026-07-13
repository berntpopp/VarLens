/**
 * CSP regression guard: the Mol* / pdbe-molstar 3D viewer MUST render a real
 * protein structure under the app's shipped Content-Security-Policy.
 *
 * WHY THIS EXISTS (PR-G / finding S4 spike, G0):
 * The shipped `script-src` includes `'unsafe-eval'`. A spike attempted to drop
 * it (keeping `'wasm-unsafe-eval'`). A Playwright `_electron` differential on a
 * real GPU proved this BREAKS the viewer: with `'unsafe-eval'` the structure
 * renders (canvas + Mol* plugin mount); without it, structure load fails and no
 * WebGL canvas is created. The exact bundled callsite is
 * h264-mp4-encoder@1.0.12's Emscripten `createNamedFunction`, which executes
 * `new Function("body", ...)` while initializing embind error classes. It is
 * pulled in by pdbe-molstar@3.12.0 -> Mol* MP4 export. This test is the guard.
 *
 * FAIL vs SKIP (important — the guard must not skip on the regression it catches):
 *   - `.molstar-element` is present in the DOM (attached, though CSS-hidden until
 *     loaded) IFF the variant has a resolvable structure (`structureUrl` is set).
 *     The empty-state ("No 3D structure available") replaces it when there is no
 *     structure. So `.molstar-element` attached == "this variant is structure-
 *     bearing", a stable precondition established BEFORE the render completes.
 *   - Once a structure-bearing variant is found, it MUST become visible
 *     (`structureLoaded` → visibility:visible). If it never does, the guard
 *     FAILS — that is precisely the `'unsafe-eval'`-removed regression (Mol*
 *     errors out, canvas never renders, `.molstar-element` stays hidden).
 *   - The ONLY skip path is a genuine precondition failure: no case / no variant
 *     / no structure-bearing variant reachable (no dev data, network, or WebGL).
 *     Skips never cover "attempted a structure and it didn't render."
 *
 * Environment: like the sibling protein-3d-*.e2e.ts, this needs the local dev
 * database (a case with a structure-bearing variant), network to the structure
 * hosts, and a working WebGL context. It is a LOCAL guard, not a CI gate.
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

type VariantOutcome =
  | { kind: 'rendered' }
  | { kind: 'no-structure-variant' }
  | { kind: 'failed'; detail: string }

/**
 * Walk the first `maxRows` variants of the selected case. For each, open the 3D
 * viewer and classify it by STABLE signals:
 *   - empty-state visible  → no structure for this variant → try the next one.
 *   - `.molstar-element` attached → structure-bearing → REQUIRE it to render
 *     (become visible). Rendered → success. Not rendered within the budget →
 *     FAIL (the regression). Capture any error-alert text for the message.
 * Returns 'no-structure-variant' only if NO variant was ever structure-bearing.
 */
async function findAndRenderStructure(
  window: Page,
  maxRows: number,
  testInfo: import('@playwright/test').TestInfo
): Promise<VariantOutcome> {
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

    const molstarEl = window.locator('.molstar-element')
    const emptyState = window.locator('text=No 3D structure available')

    // Is this variant structure-bearing? `.molstar-element` attaches (structureUrl
    // set) vs the empty-state showing. Whichever resolves first classifies it.
    const classification = await Promise.race([
      molstarEl
        .waitFor({ state: 'attached', timeout: 25_000 })
        .then(() => 'structure' as const)
        .catch(() => 'unknown' as const),
      emptyState
        .waitFor({ state: 'visible', timeout: 25_000 })
        .then(() => 'empty' as const)
        .catch(() => 'unknown' as const)
    ])

    if (classification !== 'structure') {
      log(`row ${i}: ${classification} (not structure-bearing) — next`)
      await window.keyboard.press('Escape')
      await window.waitForTimeout(300)
      continue
    }

    // Structure-bearing: it MUST render. Hidden→visible is `structureLoaded`.
    log(`row ${i}: structure-bearing — requiring render`)
    const rendered = await molstarEl
      .waitFor({ state: 'visible', timeout: 60_000 })
      .then(() => true)
      .catch(() => false)

    if (rendered) {
      await window.screenshot({ path: testInfo.outputPath(`row-${i}-rendered.png`) })
      return { kind: 'rendered' }
    }

    // Structure-bearing but never rendered = the regression (or a broken viewer).
    const errText = await window
      .locator('.molstar-viewer-container .v-alert')
      .innerText()
      .catch(() => '(no error alert found)')
    await window.screenshot({ path: testInfo.outputPath(`row-${i}-FAILED.png`) })
    return {
      kind: 'failed',
      detail:
        `variant row ${i} is structure-bearing (.molstar-element attached) but the ` +
        `3D viewer never rendered within 60s. This is the 'unsafe-eval'-removed ` +
        `regression signature (bundled Emscripten codegen blocked → viewer init fails). ` +
        `Viewer error box: ${errText}`
    }
  }

  return { kind: 'no-structure-variant' }
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
    // The bundled h264-mp4-encoder Emscripten runtime needs it. If this ever
    // changes, revisit the G0 spike and the exact callsite documented above.
    const csp = await window.evaluate(
      () =>
        document
          .querySelector('meta[http-equiv="Content-Security-Policy"]')
          ?.getAttribute('content') ?? ''
    )
    expect(csp, "shipped CSP must retain 'unsafe-eval' for the Mol* worker").toContain("'unsafe-eval'")

    await dismissDisclaimer(window)

    // Precondition skips (established BEFORE any render attempt): no data to exercise.
    const caseItem = window.locator('.v-list-item').first()
    if ((await caseItem.count()) === 0) {
      test.skip(true, 'Precondition: no cases in local database — cannot exercise the viewer')
      return
    }
    await caseItem.click()
    await window.waitForTimeout(2000)

    if ((await window.locator('.v-data-table tbody tr').count()) === 0) {
      test.skip(true, 'Precondition: no variants in the first case — cannot exercise the viewer')
      return
    }

    const outcome = await findAndRenderStructure(window, 12, testInfo)
    log(`outcome: ${outcome.kind}`)

    if (outcome.kind === 'no-structure-variant') {
      // Precondition: none of the tried variants had a resolvable structure
      // (no structure-bearing data / network / WebGL). Never reached a render.
      test.skip(
        true,
        'Precondition: no structure-bearing variant reachable (no structure data / network / WebGL)'
      )
      return
    }

    if (outcome.kind === 'failed') {
      // Hard fail — a structure-bearing variant did NOT render. This is the guard
      // doing its job: the shipped CSP (or the viewer) is broken.
      throw new Error(`CSP guard FAILED: ${outcome.detail}`)
    }

    expect(outcome.kind).toBe('rendered')
  } finally {
    if (app) await app.close()
  }
})
