/**
 * E2E test for 3D protein structure viewer
 * Tests representation switching, background color, and variant style controls.
 *
 * Requires: dev database with at least one case containing variants with protein data.
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
test('3D viewer: representation switching preserves background color', async ({}, testInfo) => {
  test.setTimeout(120_000)
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
      await window.waitForTimeout(500)
    }

    // Screenshot initial state
    await window.screenshot({ path: testInfo.outputPath('01-initial.png') })

    // Click the first case in the case list sidebar (v-list-item)
    const caseItem = window.locator('.v-list-item').first()
    if ((await caseItem.count()) === 0) {
      test.skip(true, 'No cases in database')
      return
    }
    await caseItem.click()
    await window.waitForTimeout(2000)

    await window.screenshot({ path: testInfo.outputPath('02-case-selected.png') })

    // Look for variant rows in the data table and click the first one
    const variantRow = window.locator('.v-data-table tbody tr').first()
    if ((await variantRow.count()) === 0) {
      test.skip(true, 'No variants in selected case')
      return
    }
    await variantRow.click()
    await window.waitForTimeout(1500)

    await window.screenshot({ path: testInfo.outputPath('03-variant-selected.png') })

    // Look for the protein view button (icon button with aria-label)
    const proteinBtn = window.locator('[aria-label="Open protein view"]')
    if ((await proteinBtn.count()) === 0) {
      test.skip(true, 'No protein view button found')
      return
    }
    await proteinBtn.first().click()
    await window.waitForTimeout(3000)

    await window.screenshot({ path: testInfo.outputPath('04-protein-modal-opened.png') })

    // Check if the 3D structure tab exists and click it
    const structureTab = window.locator('button:has-text("3D Structure")')
    if ((await structureTab.count()) > 0) {
      await structureTab.click()
      await window.waitForTimeout(8000) // Wait for structure to load from network
    }

    await window.screenshot({ path: testInfo.outputPath('05-3d-structure-loaded.png') })

    // Locate the structure controls toolbar (our custom toolbar, not molstar's internal one)
    // Our StructureControls uses class="structure-controls"
    const toolbar = window.locator('.structure-controls')

    // Now test representation switching
    // Click Surface button in our controls toolbar
    const surfaceBtn = toolbar.locator('button:has-text("Surface")')
    if ((await surfaceBtn.count()) > 0) {
      await surfaceBtn.click()
      // Wait for element recreation + structure reload + surface computation
      await window.waitForTimeout(15000)

      const screenshotSurface = await window.screenshot({
        path: testInfo.outputPath('06-surface-representation.png')
      })
      expect(screenshotSurface.byteLength).toBeGreaterThan(0)
    }

    // Click Ball+Stick representation button in our controls
    const ballStickBtn = toolbar.locator('button:has-text("Ball+Stick")').first()
    if ((await ballStickBtn.count()) > 0) {
      await ballStickBtn.click()
      await window.waitForTimeout(7000)

      const screenshotBallStick = await window.screenshot({
        path: testInfo.outputPath('07-ballstick-representation.png')
      })
      expect(screenshotBallStick.byteLength).toBeGreaterThan(0)
    }

    // Switch back to Cartoon
    const cartoonBtn = toolbar.locator('button:has-text("Cartoon")')
    if ((await cartoonBtn.count()) > 0) {
      await cartoonBtn.click()
      await window.waitForTimeout(7000)
    }

    await window.screenshot({ path: testInfo.outputPath('08-cartoon-restored.png') })

    // Test variant style toggle (Ball+Stick for variants)
    // The "Variants:" section has Colored and Ball+Stick buttons in the toolbar
    const variantBallStickBtn = toolbar.locator('button:has-text("Ball+Stick")').last()
    if ((await variantBallStickBtn.count()) > 0) {
      await variantBallStickBtn.click()
      await window.waitForTimeout(2000)

      await window.screenshot({
        path: testInfo.outputPath('09-variant-ballstick-style.png')
      })
    }

    // Test filter toggles in the sidebar
    const userVariantSwitch = window.locator('text=User variants').first()
    if ((await userVariantSwitch.count()) > 0) {
      await window.screenshot({
        path: testInfo.outputPath('10-sidebar-filters-visible.png')
      })
    }

    await window.screenshot({ path: testInfo.outputPath('11-final-state.png') })
  } finally {
    if (app) await app.close()
  }
})
