/**
 * E2E test for Filter UX Phase 1 quick wins.
 * Verifies preset labels, section headers, value previews,
 * and active filter bar improvements.
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
test('filter drawer shows section headers and directional preset labels', async ({}, testInfo) => {
  test.setTimeout(60000)
  let app: ElectronApplication | undefined
  try {
    app = await launchApp()
    const window = await app.firstWindow()

    // Wait for Vuetify app to be ready
    await window.waitForSelector('.v-application', { timeout: 15000 })

    // Dismiss disclaimer dialog if present
    const disclaimerBtn = window.locator('button:has-text("I Understand")')
    if ((await disclaimerBtn.count()) > 0) {
      await disclaimerBtn.click()
      await window.waitForTimeout(300)
    }

    // Select the first case from the sidebar to load variants and show filter toolbar
    const firstCase = window.locator('.v-navigation-drawer .v-list-item').first()
    await expect(firstCase).toBeVisible({ timeout: 10000 })
    await firstCase.click()
    await window.waitForTimeout(1000)

    // Wait for the filter toolbar to appear (indicates case has loaded)
    const filterToolbar = window.locator('.filter-toolbar-container')
    await expect(filterToolbar).toBeVisible({ timeout: 15000 })

    await window.screenshot({ path: testInfo.outputPath('01-case-loaded.png') })

    // Open filter drawer via the Filters button (Vuetify v-btn)
    const filtersBtn = window.locator('.v-btn:has-text("Filters")').first()
    await expect(filtersBtn).toBeVisible({ timeout: 5000 })
    await filtersBtn.click()
    await window.waitForTimeout(500)

    await window.screenshot({ path: testInfo.outputPath('02-filter-drawer-open.png') })

    // Verify section headers are present
    const variantPropsHeader = window.locator(
      '.filter-section-header:has-text("Variant Properties")'
    )
    await expect(variantPropsHeader).toBeVisible({ timeout: 5000 })

    const populationHeader = window.locator('.filter-section-header:has-text("Population")')
    await expect(populationHeader).toBeVisible()

    const annotationsHeader = window.locator('.filter-section-header:has-text("Annotations")')
    await expect(annotationsHeader).toBeVisible()

    // Frequency panel is expanded by default — verify preset labels
    // Use getByText which handles special characters better
    const afPresetChip = window.getByText('<= 1%', { exact: true })
    await expect(afPresetChip).toBeVisible({ timeout: 5000 })

    await window.screenshot({ path: testInfo.outputPath('03-frequency-presets.png') })

    // Verify CADD presets — expand the CADD panel first
    const caddTitle = window.locator('.v-expansion-panel-title:has-text("CADD")')
    await caddTitle.click()
    await window.waitForTimeout(300)

    // Check CADD preset chips show '>= X' format
    const caddPresetChip = window.getByText('>= 20', { exact: true })
    await expect(caddPresetChip).toBeVisible()

    await window.screenshot({ path: testInfo.outputPath('04-cadd-presets.png') })

    // Click a frequency preset to activate it
    await afPresetChip.click()
    await window.waitForTimeout(300)

    // Find the frequency panel for later reference
    const frequencyPanel = window.locator(
      '.v-expansion-panel:has(.v-expansion-panel-title:has-text("Frequency"))'
    )
    const freqTitle = frequencyPanel.locator('.v-expansion-panel-title')

    // Collapse the frequency panel to see value summary
    await freqTitle.click()
    await window.waitForTimeout(300)

    // The value summary should show '<= 1.00%' on the collapsed panel
    const valueSummary = frequencyPanel.locator('.filter-value-summary')
    await expect(valueSummary).toBeVisible()
    await expect(valueSummary).toContainText('<= 1.00%')

    await window.screenshot({ path: testInfo.outputPath('05-collapsed-value-preview.png') })

    // Close filter drawer by clicking outside or finding close button
    // Use Escape key to close
    await window.keyboard.press('Escape')
    await window.waitForTimeout(500)

    // Verify active filter bar is visible with improved styling
    const filterBar = window.locator('.applied-filters-bar')
    await expect(filterBar).toBeVisible({ timeout: 5000 })

    // Verify filter icon is present (replaced "Active:" text)
    const filterIcon = filterBar.locator('.mdi-filter-check')
    await expect(filterIcon).toBeVisible()

    // Verify chip shows 'AF' label with '<= 1.00%' value
    // Note: '<=' may render as '≤' in text content
    const afChip = filterBar.locator('.v-chip:has-text("AF")')
    await expect(afChip).toBeVisible()
    await expect(afChip).toContainText('1.00%')

    // Verify "Clear all" button exists
    const clearAllBtn = filterBar.locator('.v-btn:has-text("Clear all")')
    await expect(clearAllBtn).toBeVisible()

    await window.screenshot({ path: testInfo.outputPath('06-active-filter-bar.png') })
  } finally {
    if (app) await app.close()
  }
})
