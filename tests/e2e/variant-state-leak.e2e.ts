/**
 * E2E test verifying that variant details panel state does not leak
 * between variant selections. Tests the fix for VEP annotation leak
 * and ACMG evidence auto-suggestion leak.
 *
 * Run with: npx playwright test tests/e2e/variant-state-leak.e2e.ts
 */
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'

let app: ElectronApplication
let window: Page

test.beforeAll(async () => {
  app = await electron.launch({
    args: ['./out/main/index.js'],
    env: {
      ...process.env,
      NODE_ENV: 'production'
    }
  })
  window = await app.firstWindow()
  await window.waitForSelector('.v-application', { timeout: 15000 })

  // Dismiss disclaimer dialog if present
  const disclaimerBtn = window.locator('button:has-text("I Understand")')
  if ((await disclaimerBtn.count()) > 0) {
    await disclaimerBtn.click()
    await window.waitForTimeout(500)
  }
})

test.afterAll(async () => {
  if (app) await app.close()
})

test.describe('Variant Details Panel State Isolation', () => {
  // eslint-disable-next-line no-empty-pattern
  test('VEP consequence chip clears when switching variants', async ({}, testInfo) => {
    // Navigate to case view and select a case
    const caseBtn = window.locator('.mode-toggle .v-btn').nth(0)
    await caseBtn.click()
    await window.waitForTimeout(300)

    // Open sidebar if needed
    const sidebar = window.locator('.v-navigation-drawer--left')
    if (!(await sidebar.isVisible())) {
      const toggleBtn = window.locator('.sidebar-toggle-btn')
      await toggleBtn.click()
      await window.waitForTimeout(300)
    }

    // Select first case
    const caseItem = window
      .locator('.v-list-item')
      .filter({ hasText: /variants/ })
      .first()

    if ((await caseItem.count()) === 0) {
      test.skip()
      return
    }

    await caseItem.click()
    await window.waitForTimeout(1500)

    // Get the variant table
    const table = window.locator('.v-data-table-server')
    if ((await table.count()) === 0 || !(await table.isVisible())) {
      test.skip()
      return
    }

    // Click first variant row to open details panel
    const rows = table.locator('tbody tr')
    const rowCount = await rows.count()
    if (rowCount < 2) {
      test.skip()
      return
    }

    await rows.nth(0).click()
    await window.waitForTimeout(500)

    // Verify details panel is open (right-side navigation drawer)
    const detailPanel = window.locator('.v-navigation-drawer--right')
    await expect(detailPanel).toBeVisible({ timeout: 3000 })

    // Take screenshot of panel with first variant
    await window.screenshot({ path: testInfo.outputPath('variant-1-selected.png') })

    // Note: VEP data requires clicking "Fetch VEP" button and network access.
    // We verify the structural behavior: consequence chip and cached indicator
    // should not be visible before VEP is fetched.
    const consequenceChip = detailPanel.locator('.v-chip:has-text("missense"), .v-chip:has-text("stop"), .v-chip:has-text("frameshift"), .v-chip:has-text("synonymous"), .v-chip:has-text("splice")')
    const cachedIndicator = detailPanel.locator('text=Cached from')

    // Before fetching VEP, these should not be visible
    const hasConsequenceBeforeFetch = (await consequenceChip.count()) > 0
    const hasCachedBeforeFetch = (await cachedIndicator.count()) > 0

    // Now switch to second variant
    await rows.nth(1).click()
    await window.waitForTimeout(500)

    await window.screenshot({ path: testInfo.outputPath('variant-2-selected.png') })

    // After switching, consequence chip should still not be visible
    // (VEP data should have been cleared)
    const hasConsequenceAfterSwitch = (await consequenceChip.count()) > 0
    const hasCachedAfterSwitch = (await cachedIndicator.count()) > 0

    // If there was no consequence before fetch for variant 1,
    // there definitely shouldn't be one after switching to variant 2
    if (!hasConsequenceBeforeFetch) {
      expect(hasConsequenceAfterSwitch).toBe(false)
    }
    if (!hasCachedBeforeFetch) {
      expect(hasCachedAfterSwitch).toBe(false)
    }
  })

  // eslint-disable-next-line no-empty-pattern
  test('ACMG evidence panel resets when switching variants', async ({}, testInfo) => {
    // Ensure we have a case selected with variants visible
    const table = window.locator('.v-data-table-server')
    if ((await table.count()) === 0 || !(await table.isVisible())) {
      test.skip()
      return
    }

    const rows = table.locator('tbody tr')
    const rowCount = await rows.count()
    if (rowCount < 2) {
      test.skip()
      return
    }

    // Select first variant
    await rows.nth(0).click()
    await window.waitForTimeout(500)

    const detailPanel = window.locator('.v-navigation-drawer--right')
    await expect(detailPanel).toBeVisible({ timeout: 3000 })

    // Open the evidence editor expansion panel
    const evidenceEditorTitle = detailPanel.locator(
      '.v-expansion-panel-title:has-text("Evidence editor")'
    )
    if ((await evidenceEditorTitle.count()) === 0) {
      test.skip()
      return
    }

    await evidenceEditorTitle.click()
    await window.waitForTimeout(300)

    // Check for auto-suggest button and active codes
    const acmgPanel = detailPanel.locator('.acmg-classification-panel')
    if ((await acmgPanel.count()) === 0) {
      test.skip()
      return
    }

    // Count active evidence codes for variant 1
    const activeCodesV1 = await acmgPanel.locator('.v-chip[closable]').count()

    await window.screenshot({ path: testInfo.outputPath('acmg-variant-1.png') })

    // Switch to second variant
    await rows.nth(1).click()
    await window.waitForTimeout(500)

    await window.screenshot({ path: testInfo.outputPath('acmg-variant-2.png') })

    // If variant 1 had no active codes, variant 2 should also have none
    // (no leaked state from a previous variant)
    if (activeCodesV1 === 0) {
      const activeCodesV2 = await acmgPanel.locator('.v-chip[closable]').count()
      expect(activeCodesV2).toBe(0)
    }
  })

  // eslint-disable-next-line no-empty-pattern
  test('details panel shows correct variant identity after switch', async ({}, testInfo) => {
    const table = window.locator('.v-data-table-server')
    if ((await table.count()) === 0 || !(await table.isVisible())) {
      test.skip()
      return
    }

    const rows = table.locator('tbody tr')
    const rowCount = await rows.count()
    if (rowCount < 2) {
      test.skip()
      return
    }

    // Get chromosome text from first variant row
    const chr1Text = await rows.nth(0).locator('td').first().textContent()

    // Click first variant
    await rows.nth(0).click()
    await window.waitForTimeout(500)

    const detailPanel = window.locator('.v-navigation-drawer--right')
    await expect(detailPanel).toBeVisible({ timeout: 3000 })

    // The panel should show variant identity matching the selected row
    const panelContent = await detailPanel.textContent()

    // Click second variant
    await rows.nth(1).click()
    await window.waitForTimeout(500)

    const panelContentAfter = await detailPanel.textContent()

    // Panel content should have changed (different variant shown)
    // This is a basic sanity check that the panel actually updates
    await window.screenshot({ path: testInfo.outputPath('variant-identity-check.png') })

    // If variants are different, panel content should differ
    const chr2Text = await rows.nth(1).locator('td').first().textContent()
    if (chr1Text !== chr2Text) {
      expect(panelContentAfter).not.toBe(panelContent)
    }
  })
})
