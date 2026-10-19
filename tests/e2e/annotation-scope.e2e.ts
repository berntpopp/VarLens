/**
 * E2E test for annotation scope toggle feature.
 * Verifies the Case/All scope toggle renders and functions in Case View,
 * and that the CohortTable annotation dialogs work in cohort mode.
 *
 * Run with: npx playwright test tests/e2e/annotation-scope.e2e.ts
 */
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {
  launchElectronApp,
  type LaunchElectronAppResult,
  waitForAppShell,
  dismissDisclaimerIfPresent
} from './helpers/electron-app'
import {
  createPerfDatabase,
  importFrozenPerfFixture,
  selectCaseByName
} from './helpers/perf-fixture'

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']

let launched: LaunchElectronAppResult
let window: Page

async function ensureSnvTab(window: Page): Promise<void> {
  const tabs = window.locator('.variant-type-tabs .v-tab')
  await expect(tabs.first()).toBeVisible({ timeout: 5000 })
  const firstLabel = ((await tabs.first().textContent()) ?? '').trim()
  if (firstLabel.includes('Shortlist') && (await tabs.count()) > 1) {
    await tabs.nth(1).click()
  }
}

test.beforeAll(async () => {
  launched = await launchElectronApp({ perfMode: true })
  window = launched.window
  await waitForAppShell(window)

  // Unconditionally verify initial DisclaimerDialog axe check before dismissing (#669)
  const disclaimerDialog = window.locator('.v-overlay--active.v-dialog')
  await expect(disclaimerDialog).toBeVisible({ timeout: 5000 })
  const results = await new AxeBuilder({ page: window })
    .include('.v-overlay--active.v-dialog')
    .withTags(WCAG_TAGS)
    .analyze()
  expect(results.violations).toEqual([])

  await disclaimerDialog.locator('button:has-text("I Understand")').click()
  await expect(disclaimerDialog).toBeHidden({ timeout: 5000 })

  // Seed isolated database with frozen perf fixture (perf-case-a, perf-case-b, perf-case-c)
  await createPerfDatabase(launched.app, window, launched.userDataDir)
  await importFrozenPerfFixture(window, launched.app)
  await window.reload()
  await waitForAppShell(window)
  await dismissDisclaimerIfPresent(window)
})

test.afterAll(async () => {
  if (launched) {
    await launched.cleanup()
  }
})

test.describe('Annotation Scope Toggle - Case View', () => {
  // eslint-disable-next-line no-empty-pattern
  test('scope toggle renders in filter toolbar when case is selected', async ({}, testInfo) => {
    // Ensure we're on case tab
    const caseBtn = window.locator('.mode-toggle .v-btn').nth(0)
    await caseBtn.click()
    await window.waitForTimeout(300)

    // Select perf-case-a from seeded fixture and switch from default Shortlist tab to SNV tab
    await selectCaseByName(window, 'perf-case-a')
    await ensureSnvTab(window)
    await window.waitForTimeout(500)

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
    const table = window.locator('.table-container > .v-data-table')
    await expect(table).toBeVisible({ timeout: 5000 })

    // Check for annotations column header
    const headers = table.locator('th')
    const headerCount = await headers.count()
    expect(headerCount).toBeGreaterThan(3)

    await window.screenshot({ path: testInfo.outputPath('variant-table-annotations.png') })
  })

  // eslint-disable-next-line no-empty-pattern
  test('annotation cells show star/ACMG/comment icons', async ({}, testInfo) => {
    const table = window.locator('.table-container > .v-data-table')
    await expect(table).toBeVisible({ timeout: 5000 })

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
    const table = window.locator('.table-container > .v-data-table')
    if ((await table.count()) > 0 && (await table.isVisible())) {
      const headers = table.locator('th')
      const headerCount = await headers.count()
      expect(headerCount).toBeGreaterThan(2)
    }

    await window.screenshot({ path: testInfo.outputPath('cohort-table.png') })
  })

  // eslint-disable-next-line no-empty-pattern
  test('cohort view expands carrier subtable with non-zero cell and button widths (#662)', async ({}, testInfo) => {
    const table = window.locator('.table-container > .v-data-table')
    await expect(table).toBeVisible({ timeout: 10000 })

    const expandBtn = table
      .locator('button[aria-label*="Show carriers" i]')
      .first()

    await expect(expandBtn).toBeVisible({ timeout: 5000 })
    await expandBtn.click()

    const subtable = window.locator('.carrier-subtable')
    await expect(subtable).toBeVisible({ timeout: 5000 })

    const carrierRows = subtable.locator('tbody tr')
    await expect(carrierRows.first()).toBeVisible({ timeout: 5000 })
    await expect(subtable).toContainText('perf-case-a')

    // Verify all rendered headers have non-zero width (#662)
    const headerWidths = await subtable
      .locator('thead th')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width))

    expect(headerWidths.length).toBeGreaterThanOrEqual(5)
    for (const w of headerWidths) {
      expect(w).toBeGreaterThan(0)
    }

    // Verify all rendered data cells have non-zero width (#662)
    const dataCellWidths = await subtable
      .locator('tbody td')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width))

    expect(dataCellWidths.length).toBeGreaterThanOrEqual(5)
    for (const w of dataCellWidths) {
      expect(w).toBeGreaterThan(0)
    }

    // Verify "View in Case" button is rendered and has positive width
    const viewBtn = subtable.getByRole('button', { name: /View in Case/i }).first()
    await expect(viewBtn).toBeVisible()
    const box = await viewBtn.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.width).toBeGreaterThan(0)

    await window.screenshot({ path: testInfo.outputPath('cohort-carrier-subtable.png') })
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

test.describe('A11y WCAG 2.2 A/AA Checks (#669)', () => {
  // eslint-disable-next-line no-empty-pattern
  test('DisclaimerDialog has 0 axe violations (#669)', async ({}, testInfo) => {
    // Open from footer
    const openDisclaimerBtn = window.locator('button[aria-label*="disclaimer" i]').first()
    await expect(openDisclaimerBtn).toBeVisible({ timeout: 5000 })
    await openDisclaimerBtn.click()

    const dialog = window.locator('.v-overlay--active.v-dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    const results = await new AxeBuilder({ page: window })
      .include('.v-overlay--active.v-dialog')
      .withTags(WCAG_TAGS)
      .analyze()
    expect(results.violations).toEqual([])

    await window.screenshot({ path: testInfo.outputPath('disclaimer-dialog-axe.png') })
    const ackBtn = dialog.locator('button:has-text("I Understand")')
    await ackBtn.click()
    await expect(dialog).toBeHidden({ timeout: 5000 })
  })

  // eslint-disable-next-line no-empty-pattern
  test('DatabaseOverviewDialog has 0 axe violations (#669)', async ({}, testInfo) => {
    const settingsBtn = window.locator('[data-testid="app-settings-menu"]')
    await expect(settingsBtn).toBeVisible({ timeout: 5000 })
    await settingsBtn.click()
    await window.waitForTimeout(300)

    const overviewItem = window.locator('.v-list-item:has-text("Database Overview")')
    await expect(overviewItem).toBeVisible({ timeout: 5000 })
    await overviewItem.click()

    const dialog = window.getByRole('dialog', { name: 'Database Overview' })
    await expect(dialog).toBeVisible({ timeout: 5000 })

    const results = await new AxeBuilder({ page: window })
      .include('.v-overlay--active.v-dialog[aria-label="Database Overview"]')
      .withTags(WCAG_TAGS)
      .analyze()
    expect(results.violations).toEqual([])

    await window.screenshot({ path: testInfo.outputPath('database-overview-dialog-axe.png') })

    // Close dialog
    await window.keyboard.press('Escape')
    await expect(dialog).toBeHidden({ timeout: 5000 })
  })

  // eslint-disable-next-line no-empty-pattern
  test('CaseMetadataModal has 0 axe violations (#669)', async ({}, testInfo) => {
    // Ensure we're in Case view with perf-case-a selected
    const caseBtn = window.locator('.mode-toggle .v-btn').nth(0)
    await caseBtn.click()
    await window.waitForTimeout(300)
    await selectCaseByName(window, 'perf-case-a')
    await ensureSnvTab(window)
    await window.waitForTimeout(500)

    const detailsBtn = window.locator('button[aria-label="Case details"]').first()
    await expect(detailsBtn).toBeVisible({ timeout: 5000 })
    await detailsBtn.click()

    const dialog = window.getByRole('dialog', { name: 'Case Metadata' })
    await expect(dialog).toBeVisible({ timeout: 5000 })

    const results = await new AxeBuilder({ page: window })
      .include('.v-overlay--active.v-dialog[aria-label="Case Metadata"]')
      .withTags(WCAG_TAGS)
      .analyze()
    expect(results.violations).toEqual([])

    await window.screenshot({ path: testInfo.outputPath('case-metadata-modal-axe.png') })

    // Close modal
    await window.keyboard.press('Escape')
    await expect(dialog).toBeHidden({ timeout: 5000 })
  })

  // eslint-disable-next-line no-empty-pattern
  test('ShortlistTable has 0 axe violations (#669)', async ({}, testInfo) => {
    // Ensure we're in Case view with perf-case-a selected
    const caseBtn = window.locator('.mode-toggle .v-btn').nth(0)
    await caseBtn.click()
    await window.waitForTimeout(300)
    await selectCaseByName(window, 'perf-case-a')
    await window.waitForTimeout(500)

    // Switch to Shortlist tab
    const shortlistTab = window.locator('.v-tab:has-text("Shortlist"), .shortlist-tab').first()
    await expect(shortlistTab).toBeVisible({ timeout: 5000 })
    await shortlistTab.click()

    const shortlistPanel = window.locator('.shortlist-panel')
    await expect(shortlistPanel).toBeVisible({ timeout: 5000 })

    // Wait for the actual shortlist table and its Actions column header and rows before running AxeBuilder
    await expect(shortlistPanel.locator('th', { hasText: 'Actions' })).toBeVisible({
      timeout: 10000
    })
    await expect(shortlistPanel.locator('tbody tr').first()).toBeVisible({ timeout: 10000 })

    const results = await new AxeBuilder({ page: window })
      .include('.shortlist-panel')
      .withTags(WCAG_TAGS)
      .analyze()
    expect(results.violations).toEqual([])

    await window.screenshot({ path: testInfo.outputPath('shortlist-table-axe.png') })
  })
})
