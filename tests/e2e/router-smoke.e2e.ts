/**
 * E2E smoke test for Vue Router integration.
 * Verifies the app launches with router and basic navigation works.
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
test('app launches with Vue Router and renders correctly', async ({}, testInfo) => {
  let app: ElectronApplication | undefined
  try {
    app = await launchApp()
    const window = await app.firstWindow()

    // Wait for Vuetify app to be ready
    await window.waitForSelector('.v-application', { timeout: 15000 })

    // Verify the main app rendered
    const appEl = window.locator('.v-application')
    await expect(appEl).toBeVisible({ timeout: 5000 })

    // Verify app bar is present
    const appBar = window.locator('.v-app-bar')
    await expect(appBar).toBeVisible()

    // Verify mode toggle (Case/Cohort) buttons are visible
    const modeToggle = window.locator('.mode-toggle')
    await expect(modeToggle).toBeVisible()

    // Take screenshot of initial state (case view)
    await window.screenshot({ path: testInfo.outputPath('01-initial-case-view.png') })

    // Dismiss disclaimer dialog if present
    const disclaimerBtn = window.locator('button:has-text("I Understand")')
    if ((await disclaimerBtn.count()) > 0) {
      await disclaimerBtn.click()
      await window.waitForTimeout(300)
    }

    // Take screenshot after dismissing disclaimer
    await window.screenshot({ path: testInfo.outputPath('02-after-disclaimer.png') })

    // Click Cohort tab to test navigation
    const cohortBtn = window.locator('.mode-toggle .v-btn').nth(1)
    await cohortBtn.click()
    await window.waitForTimeout(500)

    // Take screenshot of cohort view
    await window.screenshot({ path: testInfo.outputPath('03-cohort-view.png') })

    // Click Case tab to navigate back
    const caseBtn = window.locator('.mode-toggle .v-btn').nth(0)
    await caseBtn.click()
    await window.waitForTimeout(500)

    // Take screenshot of case view
    await window.screenshot({ path: testInfo.outputPath('04-case-view-return.png') })

    // Verify sidebar is accessible
    const sidebar = window.locator('.v-navigation-drawer--left')
    await expect(sidebar).toBeVisible()

    // Take final screenshot
    await window.screenshot({ path: testInfo.outputPath('05-final-state.png') })
  } finally {
    if (app) await app.close()
  }
})
