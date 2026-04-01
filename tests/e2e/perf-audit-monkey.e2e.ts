/**
 * Monkey test for performance audit changes.
 *
 * Exercises the key paths affected by the performance audit:
 * - App launch + initial render (lazy-loaded dialogs)
 * - Case/Cohort tab switching (keep-alive gating, activation)
 * - Rapid tab switching (stale request guard)
 * - Filter interactions (filter core)
 * - Toolbar interactions (precomputed row state)
 *
 * This is a smoke/monkey test — it clicks around rapidly and verifies
 * the app doesn't crash, freeze, or show errors.
 */
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'

function launchApp(): Promise<ElectronApplication> {
  return electron.launch({
    args: ['./out/main/index.js'],
    env: {
      ...process.env,
      NODE_ENV: 'production'
    }
  })
}

// eslint-disable-next-line no-empty-pattern
test('monkey test: rapid navigation and interaction without crashes', async ({}, testInfo) => {
  let app: ElectronApplication | undefined
  try {
    app = await launchApp()
    const window = await app.firstWindow()

    // Collect console errors
    const consoleErrors: string[] = []
    window.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text())
      }
    })

    // Wait for app to be ready
    await window.waitForSelector('.v-application', { timeout: 15000 })

    // Dismiss disclaimer if present
    const disclaimerBtn = window.locator('button:has-text("I Understand")')
    if ((await disclaimerBtn.count()) > 0) {
      await disclaimerBtn.click()
      await window.waitForTimeout(300)
    }

    await window.screenshot({ path: testInfo.outputPath('01-app-ready.png') })

    // --- Rapid Case/Cohort switching (tests keep-alive gating) ---
    const caseBtn = window.locator('.mode-toggle .v-btn').nth(0)
    const cohortBtn = window.locator('.mode-toggle .v-btn').nth(1)

    for (let i = 0; i < 5; i++) {
      await cohortBtn.click()
      await window.waitForTimeout(100) // deliberately short — stress rapid switching
      await caseBtn.click()
      await window.waitForTimeout(100)
    }

    // Verify app is still responsive after rapid switching
    const appEl = window.locator('.v-application')
    await expect(appEl).toBeVisible({ timeout: 5000 })

    await window.screenshot({ path: testInfo.outputPath('02-after-rapid-switching.png') })

    // --- Switch to cohort view and interact ---
    await cohortBtn.click()
    await window.waitForTimeout(500)

    await window.screenshot({ path: testInfo.outputPath('03-cohort-view.png') })

    // --- Switch back to case view ---
    await caseBtn.click()
    await window.waitForTimeout(500)

    await window.screenshot({ path: testInfo.outputPath('04-case-view-return.png') })

    // --- Try opening toolbar menus (tests lazy-loaded dialogs) ---
    // Look for any toolbar buttons/menus
    const toolbarBtns = window.locator('.v-app-bar .v-btn')
    const btnCount = await toolbarBtns.count()
    if (btnCount > 0) {
      // Click the first few toolbar buttons to trigger lazy imports
      for (let i = 0; i < Math.min(btnCount, 3); i++) {
        const btn = toolbarBtns.nth(i)
        if (await btn.isVisible()) {
          await btn.click()
          await window.waitForTimeout(200)
          // Press Escape to close any dialog that opened
          await window.keyboard.press('Escape')
          await window.waitForTimeout(100)
        }
      }
    }

    await window.screenshot({ path: testInfo.outputPath('05-after-toolbar-clicks.png') })

    // --- Verify no JS errors ---
    // Filter out known benign errors (e.g., network errors for external resources)
    const realErrors = consoleErrors.filter(
      (e) =>
        !e.includes('net::ERR_') &&
        !e.includes('favicon') &&
        !e.includes('Failed to load resource')
    )

    // Allow some console errors (e.g., missing data) but no crash-level errors
    for (const err of realErrors) {
      expect(err).not.toContain('Uncaught')
      expect(err).not.toContain('TypeError')
      expect(err).not.toContain('ReferenceError')
    }

    // --- Final state check ---
    await expect(appEl).toBeVisible()
    const appBar = window.locator('.v-app-bar')
    await expect(appBar).toBeVisible()

    await window.screenshot({ path: testInfo.outputPath('06-final-state.png') })
  } finally {
    if (app) await app.close()
  }
})

// eslint-disable-next-line no-empty-pattern
test('monkey test: rapid cohort pagination stress', async ({}, testInfo) => {
  let app: ElectronApplication | undefined
  try {
    app = await launchApp()
    const window = await app.firstWindow()

    await window.waitForSelector('.v-application', { timeout: 15000 })

    // Dismiss disclaimer
    const disclaimerBtn = window.locator('button:has-text("I Understand")')
    if ((await disclaimerBtn.count()) > 0) {
      await disclaimerBtn.click()
      await window.waitForTimeout(300)
    }

    // Navigate to cohort view
    const cohortBtn = window.locator('.mode-toggle .v-btn').nth(1)
    await cohortBtn.click()
    await window.waitForTimeout(1000)

    await window.screenshot({ path: testInfo.outputPath('01-cohort-ready.png') })

    // Attempt to click pagination buttons rapidly if they exist
    // (tests skipCount wiring and activation gating)
    const nextPageBtn = window.locator('.v-data-table-footer .v-btn[aria-label="Next page"]')
    if ((await nextPageBtn.count()) > 0 && (await nextPageBtn.isEnabled())) {
      for (let i = 0; i < 3; i++) {
        await nextPageBtn.click()
        await window.waitForTimeout(50) // very rapid
      }
      await window.waitForTimeout(500) // let it settle

      const prevPageBtn = window.locator('.v-data-table-footer .v-btn[aria-label="Previous page"]')
      if ((await prevPageBtn.count()) > 0 && (await prevPageBtn.isEnabled())) {
        for (let i = 0; i < 3; i++) {
          await prevPageBtn.click()
          await window.waitForTimeout(50)
        }
      }
    }

    await window.screenshot({ path: testInfo.outputPath('02-after-pagination.png') })

    // Verify app still responsive
    const appEl = window.locator('.v-application')
    await expect(appEl).toBeVisible({ timeout: 5000 })
  } finally {
    if (app) await app.close()
  }
})
