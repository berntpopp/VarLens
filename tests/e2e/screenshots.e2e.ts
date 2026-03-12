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
import * as zlib from 'zlib'

const SCREENSHOT_DIR = path.resolve(__dirname, '../../docs/public/screenshots')
const DEMO_DATA_PATH = path.resolve(__dirname, 'test-data/demo-case.json')
const VIEWPORT = { width: 1280, height: 800 }

let app: ElectronApplication
let window: Page
let tempGzipPath: string

/** Save a screenshot to the docs screenshot directory */
async function saveScreenshot(page: Page, name: string): Promise<void> {
  const filePath = path.join(SCREENSHOT_DIR, `${name}.png`)
  await page.screenshot({ path: filePath, type: 'png' })
}

/**
 * Add a highlight overlay around an element for documentation screenshots.
 * Draws a colored border with optional label. Returns a cleanup function.
 */
async function addHighlight(
  page: Page,
  selector: string,
  options?: { label?: string; color?: string }
): Promise<void> {
  const color = options?.color ?? 'rgba(160, 149, 136, 0.9)'
  const label = options?.label ?? ''
  await page.evaluate(
    ({ sel, clr, lbl }) => {
      const el = document.querySelector(sel)
      if (!el) return
      const rect = el.getBoundingClientRect()
      const overlay = document.createElement('div')
      overlay.className = 'screenshot-highlight'
      overlay.style.cssText = `
        position: fixed;
        top: ${rect.top - 3}px;
        left: ${rect.left - 3}px;
        width: ${rect.width + 6}px;
        height: ${rect.height + 6}px;
        border: 3px solid ${clr};
        border-radius: 6px;
        pointer-events: none;
        z-index: 99999;
        box-shadow: 0 0 0 2000px rgba(0,0,0,0.05);
      `
      if (lbl) {
        const labelEl = document.createElement('div')
        labelEl.style.cssText = `
          position: absolute;
          top: -24px;
          left: 4px;
          background: ${clr};
          color: white;
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 600;
          white-space: nowrap;
        `
        labelEl.textContent = lbl
        overlay.appendChild(labelEl)
      }
      document.body.appendChild(overlay)
    },
    { sel: selector, clr: color, lbl: label }
  )
}

/** Remove all highlight overlays */
async function clearHighlights(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelectorAll('.screenshot-highlight').forEach((el) => el.remove())
  })
}

/** Dismiss the disclaimer dialog if present */
async function dismissDisclaimer(page: Page): Promise<void> {
  const disclaimerBtn = page.locator('button:has-text("I Understand")')
  if ((await disclaimerBtn.count()) > 0) {
    await disclaimerBtn.click()
    await page.waitForTimeout(500)
  }
}

/** Ensure the case DemoCase is selected and table is visible */
async function ensureCaseSelected(page: Page): Promise<void> {
  const tableVisible = await page.locator('.v-data-table-server').isVisible().catch(() => false)
  if (!tableVisible) {
    await page.evaluate(() => {
      const items = document.querySelectorAll('.v-list-item')
      for (const item of items) {
        if (item.textContent?.includes('DemoCase')) {
          ;(item as HTMLElement).click()
          break
        }
      }
    })
    await page.waitForTimeout(3000)
  }
}

test.describe('Documentation Screenshots', () => {
  test.beforeAll(async () => {
    // Ensure screenshot directory exists
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })

    // Pre-create gzipped demo file (ImportService requires gzip input)
    const demoData = fs.readFileSync(DEMO_DATA_PATH, 'utf-8')
    const compressed = zlib.gzipSync(demoData)
    tempGzipPath = path.resolve(__dirname, 'test-data/demo-case.json.gz')
    fs.writeFileSync(tempGzipPath, compressed)

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
    // Clean up temp gzip file
    if (tempGzipPath && fs.existsSync(tempGzipPath)) {
      fs.unlinkSync(tempGzipPath)
    }
  })

  test('01 - empty state', async () => {
    // Delete any existing cases for a true empty state
    await window.evaluate(async () => {
      const api = (window as unknown as { api: { cases: { deleteAll: () => Promise<number> } } })
        .api
      await api.cases.deleteAll()
    })
    // Reload to reflect empty state in sidebar
    await window.reload()
    await window.waitForSelector('.v-application', { timeout: 30000 })
    await dismissDisclaimer(window)
    await window.waitForTimeout(1000)
    await saveScreenshot(window, 'empty-state')
  })

  test('02 - import menu', async () => {
    // Open the import menu (+ button in sidebar toolbar)
    const plusBtn = window.locator('.v-toolbar .v-btn:has(.mdi-plus)')
    if ((await plusBtn.count()) > 0) {
      await plusBtn.click()
      await window.waitForTimeout(800)
      // Highlight the import menu dropdown
      await addHighlight(window, '.v-menu .v-list', { label: 'Import options' })
      await window.waitForTimeout(300)
      await saveScreenshot(window, 'import-menu')
      await clearHighlights(window)
      // Close the menu by pressing Escape
      await window.keyboard.press('Escape')
      await window.waitForTimeout(300)
    }
  })

  test('03 - import demo case', async () => {
    // Import via the preload IPC API (window.api.import.start)
    const importResult = await window.evaluate(async (filePath) => {
      const api = (
        window as unknown as {
          api: { import: { start: (p: string, n: string) => Promise<unknown> } }
        }
      ).api
      const result = await api.import.start(filePath, 'DemoCase')
      return JSON.parse(JSON.stringify(result))
    }, tempGzipPath)

    expect((importResult as { variantCount?: number }).variantCount).toBeGreaterThan(0)

    // Reload the page to force the sidebar to pick up the new case
    await window.reload()
    await window.waitForSelector('.v-application', { timeout: 30000 })
    await dismissDisclaimer(window)
    await window.waitForTimeout(1500)

    // Look for the case in the sidebar
    const caseItem = window.locator('.v-list-item').filter({ hasText: /DemoCase/ })
    await caseItem.waitFor({ timeout: 15000 })

    // Highlight the sidebar case list
    await addHighlight(window, '.v-navigation-drawer', { label: 'Case sidebar' })
    await window.waitForTimeout(300)

    // Screenshot: case list with sidebar highlighted
    await saveScreenshot(window, 'case-list')
    await clearHighlights(window)

    // Click the case to load variants
    await caseItem.click()
    await window.waitForTimeout(2000)
  })

  test('04 - variant table', async () => {
    // Ensure variant table is visible
    await ensureCaseSelected(window)

    const rows = window.locator('.v-data-table__tr')
    await expect(rows.first()).toBeVisible({ timeout: 15000 })
    await window.waitForTimeout(500)

    await saveScreenshot(window, 'variant-table')
  })

  test('05 - filters active', async () => {
    // Open the filter drawer using keyboard shortcut Ctrl+Shift+F
    await window.keyboard.press('Control+Shift+f')
    await window.waitForTimeout(1500)

    // Highlight the filter drawer
    const filterDrawer = window.locator(
      '.v-navigation-drawer--active, .v-navigation-drawer:not(.v-navigation-drawer--close)'
    )
    if ((await filterDrawer.count()) > 0) {
      await addHighlight(
        window,
        '.v-navigation-drawer--active, .v-navigation-drawer:not(.v-navigation-drawer--close)',
        { label: 'Filter drawer' }
      )
      await window.waitForTimeout(300)
    }

    await saveScreenshot(window, 'filters-active')
    await clearHighlights(window)

    // Close the filter drawer
    await window.keyboard.press('Control+Shift+f')
    await window.waitForTimeout(500)
  })

  test('06 - column filters', async () => {
    // Per-column text filters are shown above table columns
    // Highlight the filter row in the table header
    await addHighlight(window, '.v-data-table-header', { label: 'Column filters' })
    await window.waitForTimeout(300)
    await saveScreenshot(window, 'column-filters')
    await clearHighlights(window)
  })

  test('07 - variant details panel', async () => {
    // Click a row to open the variant details panel
    const firstRow = window.locator('.v-data-table__tr').first()
    await firstRow.click()
    await window.waitForTimeout(1500)

    // Wait for the panel to appear
    const panel = window.locator('.v-navigation-drawer--right, .v-navigation-drawer--temporary')
    if (await panel.isVisible().catch(() => false)) {
      await addHighlight(window, '.v-navigation-drawer--right, .v-navigation-drawer--temporary', {
        label: 'Variant details'
      })
      await window.waitForTimeout(500)
    }

    await saveScreenshot(window, 'variant-details')
    await clearHighlights(window)
  })

  test('08 - case metadata modal', async () => {
    // Close the variant detail panel first (press Escape)
    await window.keyboard.press('Escape')
    await window.waitForTimeout(500)

    // Open case metadata via the info button next to the case name in the header
    // The case info button is typically in the app bar showing the case name
    const infoBtn = window.locator('.v-app-bar .v-btn:has(.mdi-information), button:has(.mdi-information-outline)').first()
    if ((await infoBtn.count()) > 0) {
      await infoBtn.click()
      await window.waitForTimeout(1000)
    } else {
      // Try the sidebar info icon next to the case name
      await window.evaluate(() => {
        // Trigger showCaseMetadata via the AppDialogHost
        const appEl = document.querySelector('.v-application') as HTMLElement & {
          __vue_app__: {
            config: {
              globalProperties: {
                $root: { $refs: Record<string, { showCaseMetadata?: () => void }> }
              }
            }
          }
        }
        // Try emitting the event by clicking the case name area
        const caseNameHeader = document.querySelector(
          '.v-app-bar .text-body-large, .v-app-bar .v-toolbar-title'
        )
        if (caseNameHeader) {
          ;(caseNameHeader as HTMLElement).click()
        }
      })
      await window.waitForTimeout(1000)
    }

    // Check if dialog is open
    const dialog = window.locator('.v-dialog--active, .v-dialog:visible')
    if ((await dialog.count()) > 0) {
      await addHighlight(window, '.v-dialog .v-card', { label: 'Case metadata' })
      await window.waitForTimeout(300)
    }

    await saveScreenshot(window, 'case-metadata')
    await clearHighlights(window)

    // Close the dialog
    await window.keyboard.press('Escape')
    await window.waitForTimeout(500)
  })

  test('09 - ACMG classification', async () => {
    // ACMG classification chips are in the filter toolbar
    await addHighlight(window, '.filter-bar-container, .v-toolbar:has(.v-chip)', {
      label: 'ACMG filter chips'
    })
    await window.waitForTimeout(300)
    await saveScreenshot(window, 'acmg-classification')
    await clearHighlights(window)
  })

  test('10 - annotations', async () => {
    // Highlight the annotation columns (star, bookmark, comment icons)
    await addHighlight(window, '.v-data-table-server', { label: 'Annotations (star, bookmark, comments)' })
    await window.waitForTimeout(300)
    await saveScreenshot(window, 'annotations')
    await clearHighlights(window)
  })

  test('11 - cohort view', async () => {
    // Switch to cohort mode
    const cohortBtn = window.locator('.mode-toggle .v-btn').nth(1)
    if (await cohortBtn.isVisible().catch(() => false)) {
      await addHighlight(window, '.mode-toggle', { label: 'Mode toggle' })
      await window.waitForTimeout(300)
      await cohortBtn.click()
      await window.waitForTimeout(1500)
      await clearHighlights(window)
    }

    await saveScreenshot(window, 'cohort-view')

    // Switch back to case mode
    const caseBtn = window.locator('.mode-toggle .v-btn').nth(0)
    if (await caseBtn.isVisible().catch(() => false)) {
      await caseBtn.click()
      await window.waitForTimeout(1000)
    }
  })

  // Note: dark mode screenshot removed — Vuetify theme changes via evaluate
  // don't propagate visually in the Playwright Electron context
})
