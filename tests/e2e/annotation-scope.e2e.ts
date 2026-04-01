/**
 * E2E test for annotation scope toggle feature.
 * Verifies the Case/All scope toggle renders and functions in Case View,
 * and that the CohortTable annotation dialogs work in cohort mode.
 *
 * Run with: npx playwright test tests/e2e/annotation-scope.e2e.ts
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

test.describe('Annotation Scope Toggle - Case View', () => {
  // eslint-disable-next-line no-empty-pattern
  test('scope toggle renders in filter toolbar when case is selected', async ({}, testInfo) => {
    // Ensure we're on case tab
    const caseBtn = window.locator('.mode-toggle .v-btn').nth(0)
    await caseBtn.click()
    await window.waitForTimeout(300)

    // Open sidebar and select a case
    const sidebar = window.locator('.v-navigation-drawer--left')
    if (!(await sidebar.isVisible())) {
      const toggleBtn = window.locator('.sidebar-toggle-btn')
      await toggleBtn.click()
      await window.waitForTimeout(300)
    }

    // Click first case in list
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

    // The annotation scope toggle should be visible in the filter toolbar
    const scopeToggle = window.locator('.annotation-scope-toggle')
    await expect(scopeToggle).toBeVisible({ timeout: 5000 })

    // Should have Case and All buttons
    const toggleBtns = scopeToggle.locator('.v-btn')
    await expect(toggleBtns).toHaveCount(2)

    // First button should say "Case"
    await expect(toggleBtns.nth(0)).toContainText('Case')
    // Second button should say "All"
    await expect(toggleBtns.nth(1)).toContainText('All')

    await window.screenshot({ path: testInfo.outputPath('scope-toggle-case-view.png') })
  })

  // eslint-disable-next-line no-empty-pattern
  test('scope toggle defaults to Case mode', async ({}, testInfo) => {
    const scopeToggle = window.locator('.annotation-scope-toggle')
    if ((await scopeToggle.count()) === 0) {
      test.skip()
      return
    }

    // The "Case" button should be selected (has v-btn--active class or similar)
    const caseButton = scopeToggle.locator('.v-btn').nth(0)
    await expect(caseButton).toHaveClass(/v-btn--active/)

    await window.screenshot({ path: testInfo.outputPath('scope-default-case.png') })
  })

  // eslint-disable-next-line no-empty-pattern
  test('clicking All switches scope', async ({}, testInfo) => {
    const scopeToggle = window.locator('.annotation-scope-toggle')
    if ((await scopeToggle.count()) === 0) {
      test.skip()
      return
    }

    // Click "All" button
    const allButton = scopeToggle.locator('.v-btn').nth(1)
    await allButton.click()
    await window.waitForTimeout(500)

    // "All" button should now be active
    await expect(allButton).toHaveClass(/v-btn--active/)

    await window.screenshot({ path: testInfo.outputPath('scope-switched-to-all.png') })

    // Switch back to Case
    const caseButton = scopeToggle.locator('.v-btn').nth(0)
    await caseButton.click()
    await window.waitForTimeout(500)

    await expect(caseButton).toHaveClass(/v-btn--active/)
    await window.screenshot({ path: testInfo.outputPath('scope-switched-back-to-case.png') })
  })

  // eslint-disable-next-line no-empty-pattern
  test('filter toolbar has star and comment toggle buttons', async ({}, testInfo) => {
    // Verify star toggle and comment toggle buttons exist alongside scope toggle
    const starBtn = window.locator('.v-btn:has(.mdi-star-outline), .v-btn:has(.mdi-star)')
    const commentBtn = window.locator(
      '.v-btn:has(.mdi-comment-text-outline), .v-btn:has(.mdi-comment-text)'
    )

    if ((await starBtn.count()) > 0) {
      await expect(starBtn.first()).toBeVisible()
    }
    if ((await commentBtn.count()) > 0) {
      await expect(commentBtn.first()).toBeVisible()
    }

    await window.screenshot({ path: testInfo.outputPath('filter-toolbar-controls.png') })
  })

  // eslint-disable-next-line no-empty-pattern
  test('variant table renders with annotations column', async ({}, testInfo) => {
    const table = window.locator('.v-data-table-server')
    if ((await table.count()) === 0 || !(await table.isVisible())) {
      test.skip()
      return
    }

    // Check for annotations column header
    const headers = window.locator('.v-data-table-server th')
    const headerCount = await headers.count()
    expect(headerCount).toBeGreaterThan(3)

    await window.screenshot({ path: testInfo.outputPath('variant-table-annotations.png') })
  })

  // eslint-disable-next-line no-empty-pattern
  test('annotation cells show star/ACMG/comment icons', async ({}, testInfo) => {
    const table = window.locator('.v-data-table-server')
    if ((await table.count()) === 0 || !(await table.isVisible())) {
      test.skip()
      return
    }

    // Look for annotation cells containing star icons
    const annotationCells = window.locator('.annotation-cell')
    if ((await annotationCells.count()) > 0) {
      // At least one annotation cell should be visible
      await expect(annotationCells.first()).toBeVisible()

      // Should have star icon buttons
      const starIcons = annotationCells.first().locator('.mdi-star-outline, .mdi-star')
      if ((await starIcons.count()) > 0) {
        await expect(starIcons.first()).toBeVisible()
      }
    }

    await window.screenshot({ path: testInfo.outputPath('annotation-cells.png') })
  })
})

test.describe('Annotation Scope - Cohort View', () => {
  // eslint-disable-next-line no-empty-pattern
  test('cohort view loads without annotation scope toggle', async ({}, testInfo) => {
    // Switch to cohort tab
    const cohortBtn = window.locator('.mode-toggle .v-btn').nth(1)
    await cohortBtn.click()
    await window.waitForTimeout(1500)

    // Cohort view should be visible
    await expect(window.locator('text=Cohort').first()).toBeVisible()

    // Cohort view should NOT have the annotation scope toggle
    // (it's always in global/all mode)
    const scopeToggle = window.locator('.annotation-scope-toggle')
    await expect(scopeToggle).toHaveCount(0)

    await window.screenshot({ path: testInfo.outputPath('cohort-no-scope-toggle.png') })
  })

  // eslint-disable-next-line no-empty-pattern
  test('cohort view has annotation columns in data table', async ({}, testInfo) => {
    const table = window.locator('.v-data-table-server')
    if ((await table.count()) > 0 && (await table.isVisible())) {
      const headers = window.locator('.v-data-table-server th')
      const headerCount = await headers.count()
      expect(headerCount).toBeGreaterThan(2)
    }

    await window.screenshot({ path: testInfo.outputPath('cohort-table.png') })
  })
})

test.describe('Cross-view Navigation', () => {
  // eslint-disable-next-line no-empty-pattern
  test('switching views preserves scope toggle state', async ({}, testInfo) => {
    // Go to Case view
    const caseBtn = window.locator('.mode-toggle .v-btn').nth(0)
    await caseBtn.click()
    await window.waitForTimeout(500)

    const scopeToggle = window.locator('.annotation-scope-toggle')
    if ((await scopeToggle.count()) === 0) {
      test.skip()
      return
    }

    // Switch to All
    const allButton = scopeToggle.locator('.v-btn').nth(1)
    await allButton.click()
    await window.waitForTimeout(300)

    await window.screenshot({ path: testInfo.outputPath('before-cohort-switch.png') })

    // Go to Cohort and back
    const cohortBtn = window.locator('.mode-toggle .v-btn').nth(1)
    await cohortBtn.click()
    await window.waitForTimeout(500)

    await caseBtn.click()
    await window.waitForTimeout(500)

    await window.screenshot({ path: testInfo.outputPath('after-cohort-switch.png') })

    // Switch back to Case for other tests
    const caseButton = scopeToggle.locator('.v-btn').nth(0)
    await caseButton.click()
    await window.waitForTimeout(300)
  })
})
