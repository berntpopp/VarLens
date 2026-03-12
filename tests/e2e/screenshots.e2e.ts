/**
 * Automated screenshot generation for VarLens documentation.
 *
 * Launches the compiled Electron app, imports the demo dataset,
 * navigates through key views, and saves screenshots to docs/public/screenshots/.
 *
 * Run: npx playwright test tests/e2e/screenshots.e2e.ts
 * Prereqs: npm run rebuild:electron && npx electron-vite build
 */
import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import * as path from 'path'
import * as fs from 'fs'

const SCREENSHOT_DIR = path.resolve(__dirname, '../../docs/public/screenshots')
const DEMO_DATA_PATH = path.resolve(__dirname, 'test-data/demo-case.json')
const VIEWPORT = { width: 1280, height: 800 }

let app: ElectronApplication
let window: Page

/** Save a screenshot to the docs screenshot directory */
async function saveScreenshot(page: Page, name: string): Promise<void> {
  const filePath = path.join(SCREENSHOT_DIR, `${name}.png`)
  await page.screenshot({ path: filePath, type: 'png' })
}

/** Dismiss the disclaimer dialog if present */
async function dismissDisclaimer(page: Page): Promise<void> {
  const disclaimerBtn = page.locator('button:has-text("I Understand")')
  if ((await disclaimerBtn.count()) > 0) {
    await disclaimerBtn.click()
    await page.waitForTimeout(500)
  }
}

test.describe('Documentation Screenshots', () => {
  test.beforeAll(async () => {
    // Ensure screenshot directory exists
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })

    // Launch the compiled Electron app
    app = await electron.launch({
      args: ['./out/main/index.js'],
      env: {
        ...process.env,
        NODE_ENV: 'production'
      }
    })

    window = await app.firstWindow()
    await window.setViewportSize(VIEWPORT)
    await window.waitForSelector('.v-application', { timeout: 30000 })
    await dismissDisclaimer(window)
  })

  test.afterAll(async () => {
    if (app) await app.close()
  })

  test('01 - empty state', async () => {
    await window.waitForTimeout(500)
    await saveScreenshot(window, 'empty-state')
  })

  test('02 - import demo case', async () => {
    // Import the demo case via IPC (bypasses file dialog)
    // Must gzip the data since ImportService pipes through createGunzip()
    const demoData = fs.readFileSync(DEMO_DATA_PATH, 'utf-8')
    const importResult = await app.evaluate(async ({ app: electronApp }, jsonStr) => {
      const fsNode = require('fs')
      const pathNode = require('path')
      const zlib = require('zlib')
      const tempPath = pathNode.join(electronApp.getPath('userData'), 'demo-case.json.gz')

      // Gzip-compress the JSON before writing (ImportService requires gzipped input)
      const compressed = zlib.gzipSync(jsonStr)
      fsNode.writeFileSync(tempPath, compressed)

      // Import via ImportService with DatabaseService from the running app
      // Require paths are relative to the bundled out/main/ directory
      const { getDatabaseService } = require('./database')
      const { ImportService } = require('./import/ImportService')
      const db = getDatabaseService()
      const importService = new ImportService(db)
      const result = await importService.importVariants(tempPath, {
        caseName: 'DemoCase'
      })

      // Clean up temp file
      fsNode.unlinkSync(tempPath)
      return result
    }, demoData)

    expect(importResult.variantCount).toBeGreaterThan(0)

    // Wait for the case to appear in the sidebar and click it
    await window.waitForTimeout(1000)

    // Reload the case list by navigating
    const caseItem = window.locator('.v-list-item').filter({ hasText: /DemoCase/ })
    await caseItem.waitFor({ timeout: 10000 })

    // Screenshot: case list
    await saveScreenshot(window, 'case-list')

    // Click the case to load variants
    await caseItem.click()
    await window.waitForTimeout(1000)
  })

  test('03 - variant table', async () => {
    // Wait for the data table to load with rows
    await window.waitForSelector('.v-data-table-server', { timeout: 15000 })
    const rows = window.locator('.v-data-table__tr')
    await expect(rows.first()).toBeVisible({ timeout: 10000 })
    await window.waitForTimeout(500)

    await saveScreenshot(window, 'variant-table')
  })

  test('04 - filters active', async () => {
    // Look for the filter bar and apply a consequence filter
    // The filter bar should be visible in the case view
    const filterBar = window.locator('.filter-bar-container')
    if (await filterBar.isVisible().catch(() => false)) {
      // Try to interact with consequence filter if available
      // Click on a filter chip or dropdown to show active filtering
      await window.waitForTimeout(300)
    }

    await saveScreenshot(window, 'filters-active')
  })

  test('05 - column filters', async () => {
    // Per-column text filters are shown above table columns
    // Look for filter input fields in the table header area
    await window.waitForTimeout(300)
    await saveScreenshot(window, 'column-filters')
  })

  test('06 - variant details panel', async () => {
    // Click a row to open the variant details panel
    const firstRow = window.locator('.v-data-table__tr').first()
    await firstRow.click()
    await window.waitForTimeout(1000)

    // Wait for the panel to appear
    const panel = window.locator('.v-navigation-drawer--right, .v-navigation-drawer--temporary')
    if (await panel.isVisible().catch(() => false)) {
      await window.waitForTimeout(500)
    }

    await saveScreenshot(window, 'variant-details')
  })

  test('07 - ACMG classification', async () => {
    // ACMG classification is in the variant details panel or annotations cell
    // Look for ACMG-related elements
    await window.waitForTimeout(300)
    await saveScreenshot(window, 'acmg-classification')
  })

  test('08 - annotations', async () => {
    // Annotations include stars, comments, tags
    await window.waitForTimeout(300)
    await saveScreenshot(window, 'annotations')
  })

  test('09 - cohort view', async () => {
    // Switch to cohort mode
    const cohortBtn = window.locator('.mode-toggle .v-btn').nth(1)
    if (await cohortBtn.isVisible().catch(() => false)) {
      await cohortBtn.click()
      await window.waitForTimeout(1500)
    }

    await saveScreenshot(window, 'cohort-view')

    // Switch back to case mode
    const caseBtn = window.locator('.mode-toggle .v-btn').nth(0)
    if (await caseBtn.isVisible().catch(() => false)) {
      await caseBtn.click()
      await window.waitForTimeout(1000)
    }
  })

  test('10 - dark mode', async () => {
    // Toggle dark mode via Vuetify theme
    await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win) {
        await win.webContents.executeJavaScript(`
          const vuetify = document.querySelector('.v-application').__vue_app__.config.globalProperties.$vuetify;
          vuetify.theme.global.name.value = 'warmDark';
        `)
      }
    })

    await window.waitForTimeout(500)

    // Navigate back to case if needed, ensure table is visible
    const table = window.locator('.v-data-table-server')
    if (await table.isVisible().catch(() => false)) {
      await window.waitForTimeout(300)
    }

    await saveScreenshot(window, 'dark-mode')

    // Switch back to light mode
    await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win) {
        await win.webContents.executeJavaScript(`
          const vuetify = document.querySelector('.v-application').__vue_app__.config.globalProperties.$vuetify;
          vuetify.theme.global.name.value = 'warmLight';
        `)
      }
    })
  })
})
