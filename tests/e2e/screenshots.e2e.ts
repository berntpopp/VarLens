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
 * Add a bold highlight box around an element for documentation screenshots.
 * Uses a bright red/coral border with a labeled badge for maximum visibility.
 */
async function addHighlight(
  page: Page,
  selector: string,
  options?: { label?: string; color?: string; padding?: number }
): Promise<void> {
  const color = options?.color ?? '#e74c3c'
  const label = options?.label ?? ''
  const padding = options?.padding ?? 4
  await page.evaluate(
    ({ sel, clr, lbl, pad }) => {
      const el = document.querySelector(sel)
      if (!el) return
      const rect = el.getBoundingClientRect()
      const overlay = document.createElement('div')
      overlay.className = 'screenshot-highlight'
      overlay.style.cssText = `
        position: fixed;
        top: ${rect.top - pad}px;
        left: ${rect.left - pad}px;
        width: ${rect.width + pad * 2}px;
        height: ${rect.height + pad * 2}px;
        border: 3px solid ${clr};
        border-radius: 8px;
        pointer-events: none;
        z-index: 99999;
      `
      if (lbl) {
        const labelEl = document.createElement('div')
        labelEl.style.cssText = `
          position: absolute;
          top: -28px;
          left: 8px;
          background: ${clr};
          color: white;
          padding: 3px 10px;
          border-radius: 4px;
          font-size: 13px;
          font-weight: 700;
          white-space: nowrap;
          letter-spacing: 0.3px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        `
        labelEl.textContent = lbl
        overlay.appendChild(labelEl)
      }
      document.body.appendChild(overlay)
    },
    { sel: selector, clr: color, lbl: label, pad: padding }
  )
}

/**
 * Add a numbered callout circle at a specific element for annotation.
 */
async function addCallout(
  page: Page,
  selector: string,
  number: number,
  options?: { color?: string; position?: 'top-right' | 'top-left' | 'center' }
): Promise<void> {
  const color = options?.color ?? '#e74c3c'
  const position = options?.position ?? 'top-right'
  await page.evaluate(
    ({ sel, num, clr, pos }) => {
      const el = document.querySelector(sel)
      if (!el) return
      const rect = el.getBoundingClientRect()
      const callout = document.createElement('div')
      callout.className = 'screenshot-highlight'

      let top: number, left: number
      if (pos === 'top-left') {
        top = rect.top - 12
        left = rect.left - 12
      } else if (pos === 'center') {
        top = rect.top + rect.height / 2 - 14
        left = rect.left + rect.width / 2 - 14
      } else {
        top = rect.top - 12
        left = rect.right - 12
      }

      callout.style.cssText = `
        position: fixed;
        top: ${top}px;
        left: ${left}px;
        width: 28px;
        height: 28px;
        background: ${clr};
        color: white;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        font-weight: 800;
        pointer-events: none;
        z-index: 99999;
        box-shadow: 0 2px 6px rgba(0,0,0,0.4);
        border: 2px solid white;
      `
      callout.textContent = String(num)
      document.body.appendChild(callout)
    },
    { sel: selector, num: number, clr: color, pos: position }
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
      await addHighlight(window, '.v-overlay--active .v-list', { label: 'Import options' })
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

    // Screenshot: case list (clean, no highlights — sidebar speaks for itself)
    await saveScreenshot(window, 'case-list')

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

    // Add labeled highlights for key UI sections referenced in the docs
    await window.evaluate(() => {
      function highlight(
        el: Element,
        label: string,
        clr: string,
        opts?: { labelPos?: 'top' | 'bottom' | 'top-right'; pad?: number }
      ): void {
        const pad = opts?.pad ?? 3
        const rect = el.getBoundingClientRect()
        const div = document.createElement('div')
        div.className = 'screenshot-highlight'
        div.style.cssText = `
          position: fixed;
          top: ${rect.top - pad}px;
          left: ${rect.left - pad}px;
          width: ${rect.width + pad * 2}px;
          height: ${rect.height + pad * 2}px;
          border: 2.5px solid ${clr};
          border-radius: 6px;
          pointer-events: none;
          z-index: 99999;
        `
        const lbl = document.createElement('div')
        let posCSS = 'top: -20px; left: 8px;'
        if (opts?.labelPos === 'bottom') posCSS = 'bottom: -20px; left: 8px;'
        if (opts?.labelPos === 'top-right') posCSS = 'top: -20px; right: 8px;'
        lbl.style.cssText = `
          position: absolute; ${posCSS}
          background: ${clr}; color: white;
          padding: 2px 8px; border-radius: 3px;
          font-size: 11px; font-weight: 700;
          white-space: nowrap;
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        `
        lbl.textContent = label
        div.appendChild(lbl)
        document.body.appendChild(div)
      }

      function highlightGroup(
        els: Element[],
        label: string,
        clr: string,
        opts?: { labelPos?: 'top' | 'bottom' | 'top-right'; pad?: number }
      ): void {
        const pad = opts?.pad ?? 3
        const rects = els.map((e) => e.getBoundingClientRect())
        const top = Math.min(...rects.map((r) => r.top)) - pad
        const left = Math.min(...rects.map((r) => r.left)) - pad
        const right = Math.max(...rects.map((r) => r.right)) + pad
        const bottom = Math.max(...rects.map((r) => r.bottom)) + pad
        const div = document.createElement('div')
        div.className = 'screenshot-highlight'
        div.style.cssText = `
          position: fixed;
          top: ${top}px; left: ${left}px;
          width: ${right - left}px; height: ${bottom - top}px;
          border: 2.5px solid ${clr};
          border-radius: 6px;
          pointer-events: none;
          z-index: 99999;
        `
        const lbl = document.createElement('div')
        let posCSS = 'top: -20px; left: 8px;'
        if (opts?.labelPos === 'bottom') posCSS = 'bottom: -20px; left: 8px;'
        if (opts?.labelPos === 'top-right') posCSS = 'top: -20px; right: 8px;'
        lbl.style.cssText = `
          position: absolute; ${posCSS}
          background: ${clr}; color: white;
          padding: 2px 8px; border-radius: 3px;
          font-size: 11px; font-weight: 700;
          white-space: nowrap;
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        `
        lbl.textContent = label
        div.appendChild(lbl)
        document.body.appendChild(div)
      }

      const red = '#e74c3c'
      const blue = '#3498db'
      const green = '#27ae60'
      const purple = '#8e44ad'
      const orange = '#e67e22'

      // 1. Search bar
      const searchField = document.querySelector('.filter-toolbar .filter-search-input')
      if (searchField) highlight(searchField, 'Search (gene, position, HGVS)', red, { pad: 2 })

      // 2. Quick filters: star btn + comment btn + ACMG chip-group
      const toolbar = document.querySelector('.filter-toolbar')
      if (toolbar) {
        const starBtn = toolbar.querySelector('.v-btn .mdi-star-outline, .v-btn .mdi-star')
          ?.closest('.v-btn')
        const chipGroup = toolbar.querySelector('.v-chip-group')
        if (starBtn && chipGroup) {
          highlightGroup([starBtn, chipGroup], 'Quick filters (star, comments, ACMG)', blue)
        }
      }

      // 3. Toolbar actions: Filters, Columns, Export buttons
      const toolbarBtns = Array.from(document.querySelectorAll('.filter-toolbar .v-btn'))
      const filtersBtn = toolbarBtns.find((b) => b.textContent?.includes('Filters'))
      const exportBtn = toolbarBtns.find((b) => b.textContent?.includes('Export'))
      if (filtersBtn && exportBtn) {
        const colsBtn = toolbarBtns.find((b) => b.textContent?.includes('Columns'))
        const btns = [filtersBtn, colsBtn, exportBtn].filter(Boolean) as Element[]
        highlightGroup(btns, 'Filters / Columns / Export', green, { labelPos: 'top-right' })
      }

      // 4. Column headers with sort indicators
      const headerRow = document.querySelector('.v-data-table thead tr')
      if (headerRow) {
        highlight(headerRow, 'Sortable columns with per-column filters', purple, {
          labelPos: 'bottom',
          pad: 1
        })
      }

      // 5. Pagination
      const footer = document.querySelector('.v-data-table-footer')
      if (footer) highlight(footer, 'Pagination controls', orange, { pad: 2 })
    })
    await window.waitForTimeout(300)

    await saveScreenshot(window, 'variant-table')
    await clearHighlights(window)
  })

  test('04b - app layout overview', async () => {
    // Ensure case is selected and table is visible with sidebar open
    await ensureCaseSelected(window)
    await window.waitForTimeout(500)

    // Open sidebar if not already open
    await window.evaluate(() => {
      const sidebar = document.querySelector('.v-navigation-drawer:not(.v-navigation-drawer--temporary)')
      if (sidebar && !sidebar.classList.contains('v-navigation-drawer--active')) {
        const toggle = document.querySelector('.sidebar-toggle-btn') as HTMLElement
        if (toggle) toggle.click()
      }
    })
    await window.waitForTimeout(500)

    // Add numbered callouts and region borders for the app layout overview
    await window.evaluate(() => {
      const red = '#e74c3c'
      const blue = '#3498db'
      const green = '#27ae60'
      const orange = '#e67e22'

      /** Draw a border around a region with a label badge */
      function regionBorder(
        el: Element,
        label: string,
        clr: string,
        labelPos: 'top-left' | 'bottom-left' | 'center'
      ): void {
        const rect = el.getBoundingClientRect()
        const div = document.createElement('div')
        div.className = 'screenshot-highlight'
        div.style.cssText = `
          position: fixed;
          top: ${rect.top}px; left: ${rect.left}px;
          width: ${rect.width}px; height: ${rect.height}px;
          border: 2.5px solid ${clr}; border-radius: 2px;
          pointer-events: none; z-index: 99998;
        `
        const lbl = document.createElement('div')
        let posCSS: string
        if (labelPos === 'center') {
          posCSS = `top: 50%; left: 50%; transform: translate(-50%, -50%);`
        } else if (labelPos === 'bottom-left') {
          posCSS = `bottom: 6px; left: 8px;`
        } else {
          posCSS = `top: 6px; left: 8px;`
        }
        lbl.style.cssText = `
          position: absolute; ${posCSS}
          background: ${clr}; color: white;
          padding: 3px 12px; border-radius: 4px;
          font-size: 13px; font-weight: 700;
          white-space: nowrap;
          box-shadow: 0 2px 4px rgba(0,0,0,0.35);
          letter-spacing: 0.3px;
        `
        lbl.textContent = label
        div.appendChild(lbl)
        document.body.appendChild(div)
      }

      /** Place a numbered circle at a specific position on an element */
      function numberedCallout(
        el: Element,
        num: number,
        clr: string,
        pos: 'top-right' | 'top-left' | 'bottom-center' = 'top-right'
      ): void {
        const rect = el.getBoundingClientRect()
        let cx: number, cy: number
        if (pos === 'top-right') {
          cx = rect.right - 6
          cy = rect.top - 6
        } else if (pos === 'top-left') {
          cx = rect.left - 6
          cy = rect.top - 6
        } else {
          cx = rect.left + rect.width / 2 - 11
          cy = rect.bottom - 10
        }
        const circle = document.createElement('div')
        circle.className = 'screenshot-highlight'
        circle.style.cssText = `
          position: fixed;
          top: ${cy}px; left: ${cx}px;
          width: 22px; height: 22px;
          background: ${clr}; color: white;
          border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 12px; font-weight: 800;
          pointer-events: none; z-index: 100000;
          box-shadow: 0 2px 4px rgba(0,0,0,0.4);
          border: 2px solid white;
        `
        circle.textContent = String(num)
        document.body.appendChild(circle)
      }

      // === Region borders ===
      const appBar = document.querySelector('.v-app-bar')
      if (appBar) regionBorder(appBar, 'Title bar', red, 'top-left')

      const sidebar = document.querySelector(
        '.v-navigation-drawer:not(.v-navigation-drawer--temporary)'
      )
      if (sidebar) regionBorder(sidebar, 'Sidebar', blue, 'center')

      const mainContent = document.querySelector('.v-main')
      if (mainContent) regionBorder(mainContent, 'Content area', green, 'center')

      const footer = document.querySelector('.v-footer')
      if (footer) regionBorder(footer, 'Status bar', orange, 'top-left')

      // === Title bar numbered callouts ===
      // Use a single legend strip below the title bar for clean labeling
      if (appBar) {
        const purple = '#8e44ad'
        const barRect = appBar.getBoundingClientRect()

        // Collect all title bar elements with their positions
        const items: { el: Element; num: number; label: string; clr: string }[] = []

        const sidebarToggle = appBar.querySelector('.sidebar-toggle-btn')
        if (sidebarToggle) items.push({ el: sidebarToggle, num: 1, label: 'Sidebar toggle', clr: '#555' })

        const contextIndicator = appBar.querySelector('.context-indicator')
        if (contextIndicator) items.push({ el: contextIndicator, num: 2, label: 'Case indicator', clr: red })

        const modeToggle = appBar.querySelector('.mode-toggle')
        if (modeToggle) items.push({ el: modeToggle, num: 3, label: 'Case / Cohort', clr: purple })

        // DatabasePicker is a .text-none button containing the db name
        const dbBtn = appBar.querySelector('.v-btn.text-none')
        if (dbBtn) items.push({ el: dbBtn, num: 4, label: 'Database', clr: orange })

        const gearIcon = appBar.querySelector('.mdi-cog')
        const gearBtn = gearIcon?.closest('.v-btn')
        if (gearBtn) items.push({ el: gearBtn, num: 5, label: 'Settings', clr: green })

        // Place circles at the top-center of each element (inside the dark title bar)
        for (const item of items) {
          const r = item.el.getBoundingClientRect()
          const circle = document.createElement('div')
          circle.className = 'screenshot-highlight'
          circle.style.cssText = `
            position: fixed;
            top: ${barRect.top + 1}px;
            left: ${r.left + r.width / 2 - 10}px;
            width: 20px; height: 20px;
            background: white; color: ${item.clr};
            border-radius: 50%;
            display: flex; align-items: center; justify-content: center;
            font-size: 11px; font-weight: 900;
            pointer-events: none; z-index: 100000;
            box-shadow: 0 1px 3px rgba(0,0,0,0.4);
          `
          circle.textContent = String(item.num)
          document.body.appendChild(circle)
        }

        // Add a compact legend strip below the title bar
        const legendY = barRect.bottom + 4
        let legendX = barRect.left + 8
        for (const item of items) {
          const lbl = document.createElement('div')
          lbl.className = 'screenshot-highlight'
          lbl.style.cssText = `
            position: fixed;
            top: ${legendY}px; left: ${legendX}px;
            display: flex; align-items: center; gap: 4px;
            pointer-events: none; z-index: 100000;
            font-size: 10px; font-weight: 700;
            white-space: nowrap;
          `
          // Small circle
          const dot = document.createElement('span')
          dot.style.cssText = `
            display: inline-flex; align-items: center; justify-content: center;
            width: 16px; height: 16px; border-radius: 50%;
            background: ${item.clr}; color: white;
            font-size: 9px; font-weight: 800;
          `
          dot.textContent = String(item.num)
          const text = document.createElement('span')
          text.style.cssText = `color: ${item.clr}; text-shadow: 0 0 2px white, 0 0 4px white;`
          text.textContent = item.label
          lbl.appendChild(dot)
          lbl.appendChild(text)
          document.body.appendChild(lbl)

          // Measure approximate width for next position
          legendX += item.label.length * 7 + 30
        }
      }
    })
    await window.waitForTimeout(300)

    await saveScreenshot(window, 'app-layout')
    await clearHighlights(window)
  })

  test('04c - status bar', async () => {
    // Take a close-up of the status bar with labeled icons
    await ensureCaseSelected(window)
    await window.waitForTimeout(300)

    await window.evaluate(() => {
      const colors = {
        red: '#e74c3c',
        blue: '#3498db',
        green: '#27ae60',
        purple: '#8e44ad',
        orange: '#e67e22',
        teal: '#16a085'
      }

      function iconLabel(
        iconSelector: string,
        label: string,
        clr: string
      ): void {
        const icon = document.querySelector(`.v-footer ${iconSelector}`)
        const btn = icon?.closest('.v-btn') || icon
        if (!btn) return
        const rect = btn.getBoundingClientRect()
        // Box around the icon
        const box = document.createElement('div')
        box.className = 'screenshot-highlight'
        box.style.cssText = `
          position: fixed;
          top: ${rect.top - 3}px; left: ${rect.left - 3}px;
          width: ${rect.width + 6}px; height: ${rect.height + 6}px;
          border: 2px solid ${clr}; border-radius: 4px;
          pointer-events: none; z-index: 99999;
        `
        // Label above
        const lbl = document.createElement('div')
        lbl.style.cssText = `
          position: absolute;
          top: -20px; left: 50%; transform: translateX(-50%);
          background: ${clr}; color: white;
          padding: 1px 6px; border-radius: 3px;
          font-size: 10px; font-weight: 700;
          white-space: nowrap;
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        `
        lbl.textContent = label
        box.appendChild(lbl)
        document.body.appendChild(box)
      }

      // Version button (first button in footer)
      const versionBtn = document.querySelector('.v-footer .v-btn')
      if (versionBtn) {
        const rect = versionBtn.getBoundingClientRect()
        const box = document.createElement('div')
        box.className = 'screenshot-highlight'
        box.style.cssText = `
          position: fixed;
          top: ${rect.top - 3}px; left: ${rect.left - 3}px;
          width: ${rect.width + 6}px; height: ${rect.height + 6}px;
          border: 2px solid ${colors.red}; border-radius: 4px;
          pointer-events: none; z-index: 99999;
        `
        const lbl = document.createElement('div')
        lbl.style.cssText = `
          position: absolute;
          top: -20px; left: 4px;
          background: ${colors.red}; color: white;
          padding: 1px 6px; border-radius: 3px;
          font-size: 10px; font-weight: 700;
          white-space: nowrap;
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        `
        lbl.textContent = 'Version'
        box.appendChild(lbl)
        document.body.appendChild(box)
      }

      // Network status icon
      iconLabel('.mdi-wifi, .mdi-wifi-off', 'Network status', colors.blue)

      // GitHub
      iconLabel('.mdi-github', 'GitHub', colors.green)

      // License
      iconLabel('.mdi-license', 'License', colors.purple)

      // Disclaimer shield
      iconLabel('.mdi-shield-check, .mdi-shield-alert', 'Disclaimer', colors.orange)

      // FAQ help
      iconLabel('.mdi-help-circle', 'FAQ', colors.teal)

      // Console / log viewer
      iconLabel('.mdi-console', 'Log viewer', colors.red)
    })
    await window.waitForTimeout(300)

    // Crop to just the footer area for a close-up screenshot
    const footerRect = await window.evaluate(() => {
      const footer = document.querySelector('.v-footer')
      if (!footer) return null
      const rect = footer.getBoundingClientRect()
      // Extra space above for labels, below for padding
      return { x: rect.x, y: rect.y - 30, width: rect.width, height: rect.height + 38 }
    })

    if (footerRect) {
      const filePath = path.join(SCREENSHOT_DIR, 'status-bar.png')
      await window.screenshot({
        path: filePath,
        type: 'png',
        clip: { x: footerRect.x, y: footerRect.y, width: footerRect.width, height: footerRect.height }
      })
    } else {
      await saveScreenshot(window, 'status-bar')
    }
    await clearHighlights(window)
  })

  test('05 - filters active', async () => {
    // Click the "Filters" button in the toolbar to open the filter drawer
    const filtersBtn = window.locator('button:has-text("Filters")')
    if ((await filtersBtn.count()) > 0) {
      await filtersBtn.first().click()
      await window.waitForTimeout(1500)
    }

    // Verify filter drawer is open by looking for the "All Filters" title
    const allFiltersTitle = window.locator('text=All Filters')
    const drawerOpen = await allFiltersTitle.isVisible().catch(() => false)

    if (drawerOpen) {
      // Add highlight inside the drawer itself (appending to body doesn't work
      // because the drawer's z-index/stacking context covers it)
      await window.evaluate(({ clr }) => {
        const drawers = document.querySelectorAll('.v-navigation-drawer')
        for (const drawer of drawers) {
          if (drawer.textContent?.includes('All Filters')) {
            // Add an inner border highlight
            const highlight = document.createElement('div')
            highlight.className = 'screenshot-highlight'
            highlight.style.cssText = `
              position: absolute;
              top: 0;
              left: 0;
              right: 0;
              bottom: 0;
              border: 3px solid ${clr};
              border-radius: 0;
              pointer-events: none;
              z-index: 99999;
            `
            // Add label inside the drawer at the top-left
            const labelEl = document.createElement('div')
            labelEl.style.cssText = `
              position: absolute;
              top: 4px;
              left: 4px;
              background: ${clr};
              color: white;
              padding: 3px 10px;
              border-radius: 4px;
              font-size: 13px;
              font-weight: 700;
              white-space: nowrap;
              box-shadow: 0 2px 4px rgba(0,0,0,0.3);
              z-index: 100000;
            `
            labelEl.textContent = 'Filter drawer (click Filters button)'
            highlight.appendChild(labelEl)
            ;(drawer as HTMLElement).style.position = 'relative'
            drawer.appendChild(highlight)
            break
          }
        }
      }, { clr: '#e74c3c' })
    }

    await window.waitForTimeout(300)
    await saveScreenshot(window, 'filters-active')
    await clearHighlights(window)

    // Close the filter drawer — click the scrim overlay or press Escape
    const scrim = window.locator('.v-navigation-drawer__scrim')
    if ((await scrim.count()) > 0 && (await scrim.isVisible().catch(() => false))) {
      await scrim.click({ force: true })
    } else {
      await window.keyboard.press('Escape')
    }
    await window.waitForTimeout(500)
  })

  test('06 - column filters', async () => {
    // Column filter inputs are in the table header area
    // The header contains sortable columns with filter icons
    await window.waitForTimeout(300)

    // Try multiple selectors for the table header
    const headerSelectors = [
      'thead',
      '.v-data-table thead',
      '.v-data-table-header',
      'th:first-child'
    ]
    let matched = false
    for (const sel of headerSelectors) {
      const count = await window.locator(sel).count()
      if (count > 0) {
        await addHighlight(window, sel, {
          label: 'Per-column filters & sorting',
          color: '#e74c3c'
        })
        matched = true
        break
      }
    }
    await window.waitForTimeout(300)
    await saveScreenshot(window, 'column-filters')
    await clearHighlights(window)
  })

  test('07 - variant details panel', async () => {
    // Ensure no overlays are blocking
    await ensureCaseSelected(window)
    await window.waitForTimeout(500)

    // Click a row to open the variant details panel
    const firstRow = window.locator('.v-data-table__tr').first()
    await firstRow.click({ timeout: 10000 })
    await window.waitForTimeout(1500)

    // Wait for the details panel to appear (right-side temporary drawer)
    // Try multiple selectors to find the visible panel
    const panelSelectors = [
      '.v-navigation-drawer--temporary.v-navigation-drawer--active',
      '.v-navigation-drawer--temporary',
      '.v-navigation-drawer--right'
    ]
    for (const sel of panelSelectors) {
      const panel = window.locator(sel)
      if ((await panel.count()) > 0 && (await panel.isVisible().catch(() => false))) {
        await addHighlight(window, sel, {
          label: 'Variant details panel',
          color: '#e74c3c'
        })
        break
      }
    }
    await window.waitForTimeout(500)

    await saveScreenshot(window, 'variant-details')
    await clearHighlights(window)
  })

  test('08 - case metadata modal', async () => {
    // Close the variant detail panel first (press Escape)
    await window.keyboard.press('Escape')
    await window.waitForTimeout(500)

    // Open case metadata by clicking the info icon next to case name in the header
    const infoBtn = window
      .locator(
        '.v-app-bar .v-btn:has(.mdi-information), button:has(.mdi-information-outline)'
      )
      .first()
    if ((await infoBtn.count()) > 0) {
      await infoBtn.click()
      await window.waitForTimeout(1000)
    } else {
      // Fallback: click the case name area in the app bar
      await window.evaluate(() => {
        const caseNameHeader = document.querySelector(
          '.v-app-bar .text-body-large, .v-app-bar .v-toolbar-title'
        )
        if (caseNameHeader) {
          ;(caseNameHeader as HTMLElement).click()
        }
      })
      await window.waitForTimeout(1000)
    }

    // Highlight the dialog card if visible
    const dialogCard = window.locator('.v-overlay--active .v-card')
    if ((await dialogCard.count()) > 0) {
      await addHighlight(window, '.v-overlay--active .v-card', {
        label: 'Case metadata',
        color: '#e74c3c'
      })
      await window.waitForTimeout(300)
    }

    await saveScreenshot(window, 'case-metadata')
    await clearHighlights(window)

    // Close the dialog
    await window.keyboard.press('Escape')
    await window.waitForTimeout(500)
  })

  test('09 - ACMG classification', async () => {
    // Ensure no drawers are open first
    await window.keyboard.press('Escape')
    await window.waitForTimeout(500)

    // Open the variant details panel by clicking a row
    await ensureCaseSelected(window)
    await window.waitForTimeout(500)
    const firstRow = window.locator('.v-data-table__tr').first()
    await firstRow.click({ timeout: 10000 })
    await window.waitForTimeout(2000)

    // Step 1: Scroll to ACMG section in the variant details drawer (not the filter drawer)
    await window.evaluate(() => {
      const drawers = document.querySelectorAll('.v-navigation-drawer')
      for (const drawer of drawers) {
        if (drawer.textContent?.includes('Variant Details')) {
          const scrollContainer = drawer.querySelector('.v-navigation-drawer__content')
          const acmgSection = drawer.querySelector('.acmg-section')
          if (acmgSection && scrollContainer) {
            acmgSection.scrollIntoView({ block: 'start', behavior: 'instant' })
          }
          break
        }
      }
    })
    await window.waitForTimeout(500)

    // Step 2: Expand evidence editor — click the expansion panel title in acmg-section
    // Use Playwright locator targeting text "Evidence editor"
    const evidenceEditorTitle = window.locator(
      '.v-expansion-panel-title:has-text("Evidence editor")'
    )
    if ((await evidenceEditorTitle.count()) > 0) {
      // Scroll it into view first
      await window.evaluate(() => {
        const drawers = document.querySelectorAll('.v-navigation-drawer')
        for (const drawer of drawers) {
          if (drawer.textContent?.includes('Variant Details')) {
            const title = drawer.querySelector('.acmg-section .v-expansion-panel-title')
            if (title) title.scrollIntoView({ block: 'center', behavior: 'instant' })
            break
          }
        }
      })
      await window.waitForTimeout(300)
      await evidenceEditorTitle.first().click({ force: true })
      await window.waitForTimeout(1500)
    }

    // Step 3: Click Auto-suggest
    const autoSuggestBtn = window.locator('.v-btn:has-text("Auto-suggest")')
    if ((await autoSuggestBtn.count()) > 0) {
      await window.evaluate(() => {
        const drawers = document.querySelectorAll('.v-navigation-drawer')
        for (const drawer of drawers) {
          if (drawer.textContent?.includes('Variant Details')) {
            const btns = drawer.querySelectorAll('.v-btn')
            for (const btn of btns) {
              if (btn.textContent?.includes('Auto-suggest')) {
                btn.scrollIntoView({ block: 'center', behavior: 'instant' })
                break
              }
            }
            break
          }
        }
      })
      await window.waitForTimeout(300)
      await autoSuggestBtn.first().click({ force: true })
      await window.waitForTimeout(1500)
    }

    // Step 4: Quick-classify as LP
    await window.evaluate(() => {
      const drawers = document.querySelectorAll('.v-navigation-drawer')
      for (const drawer of drawers) {
        if (drawer.textContent?.includes('Variant Details')) {
          const acmg = drawer.querySelector('.acmg-section')
          if (acmg) acmg.scrollIntoView({ block: 'start', behavior: 'instant' })
          break
        }
      }
    })
    await window.waitForTimeout(300)

    const lpChip = window
      .locator('.acmg-section .v-chip')
      .filter({ hasText: /^LP$/ })
    if ((await lpChip.count()) > 0) {
      await lpChip.first().click({ force: true })
      await window.waitForTimeout(1000)
    }

    // Step 5: Scroll to show the evidence grid content
    await window.evaluate(() => {
      const drawers = document.querySelectorAll('.v-navigation-drawer')
      for (const drawer of drawers) {
        if (drawer.textContent?.includes('Variant Details')) {
          const scrollContainer = drawer.querySelector('.v-navigation-drawer__content')
          const acmg = drawer.querySelector('.acmg-section')
          if (acmg && scrollContainer) {
            const acmgTop = acmg.getBoundingClientRect().top
            const containerTop = scrollContainer.getBoundingClientRect().top
            // Scroll ACMG heading to the very top of the drawer
            scrollContainer.scrollTop += acmgTop - containerTop
          }
          break
        }
      }
    })
    await window.waitForTimeout(500)

    // Step 6: Add a visible highlight on the ACMG section
    await window.evaluate(({ clr }: { clr: string }) => {
      const drawers = document.querySelectorAll('.v-navigation-drawer')
      for (const drawer of drawers) {
        if (!drawer.textContent?.includes('Variant Details')) continue
        const acmgSection = drawer.querySelector('.acmg-section') as HTMLElement
        if (!acmgSection) continue

        // Apply a bold outline directly on the ACMG section element
        acmgSection.style.outline = `3px solid ${clr}`
        acmgSection.style.outlineOffset = '4px'
        acmgSection.style.borderRadius = '8px'

        // Add a floating label badge
        const scrollContainer = drawer.querySelector('.v-navigation-drawer__content')
        if (!scrollContainer) break
        ;(scrollContainer as HTMLElement).style.position = 'relative'
        const rect = acmgSection.getBoundingClientRect()
        const containerRect = scrollContainer.getBoundingClientRect()
        const labelEl = document.createElement('div')
        labelEl.className = 'screenshot-highlight'
        labelEl.style.cssText = `
          position: absolute;
          top: ${rect.top - containerRect.top + scrollContainer.scrollTop - 24}px;
          left: ${rect.left - containerRect.left + 8}px;
          background: ${clr};
          color: white;
          padding: 3px 10px;
          border-radius: 4px;
          font-size: 13px;
          font-weight: 700;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
          z-index: 100000;
          pointer-events: none;
        `
        labelEl.textContent = 'ACMG classification + evidence editor'
        scrollContainer.appendChild(labelEl)
        break
      }
    }, { clr: '#e74c3c' })

    await window.waitForTimeout(300)
    await saveScreenshot(window, 'acmg-classification')
    await clearHighlights(window)

    // Close the panel
    await window.keyboard.press('Escape')
    await window.waitForTimeout(500)
  })

  test('10 - comment dialog', async () => {
    // Open variant details and click the comment icon to open the comment dialog
    await ensureCaseSelected(window)
    await window.waitForTimeout(500)

    // Click the comment icon on the first row via evaluate
    await window.evaluate(() => {
      const firstRow = document.querySelector('.v-data-table__tr')
      if (!firstRow) return
      // Find comment icon (mdi-comment-text-outline)
      const commentIcon = firstRow.querySelector('.mdi-comment-text-outline')
      if (commentIcon) {
        ;(commentIcon as HTMLElement).click()
      }
    })
    await window.waitForTimeout(1000)

    // Check if comment dialog is open
    const commentDialog = window.locator('.v-overlay--active .v-card:has-text("Comment")')
    if ((await commentDialog.count()) > 0) {
      await addHighlight(window, '.v-overlay--active .v-card', {
        label: 'Comment dialog',
        color: '#e74c3c'
      })
      await window.waitForTimeout(300)
    }

    await saveScreenshot(window, 'comment-dialog')
    await clearHighlights(window)

    // Close the dialog
    await window.keyboard.press('Escape')
    await window.waitForTimeout(500)
  })

  test('11 - annotations overview', async () => {
    // Ensure no overlays
    await ensureCaseSelected(window)
    await window.waitForTimeout(500)

    // Annotations: star, ACMG, comment icons in the first column of each row
    // Use evaluate to find and annotate the first row's annotation icons
    await window.evaluate(() => {
      const firstRow = document.querySelector('.v-data-table__tr')
      if (!firstRow) return

      // Find the annotation wrapper elements (star, ACMG, comment)
      const wrappers = firstRow.querySelectorAll('.annotation-icon-wrapper')
      const colors = ['#e74c3c', '#3498db', '#2ecc71']
      const labels = ['Star', 'ACMG', 'Comment']

      wrappers.forEach((wrapper, i) => {
        if (i >= 3) return
        const rect = wrapper.getBoundingClientRect()
        const callout = document.createElement('div')
        callout.className = 'screenshot-highlight'
        callout.style.cssText = `
          position: fixed;
          top: ${rect.top - 14}px;
          left: ${rect.left + rect.width / 2 - 14}px;
          width: 28px;
          height: 28px;
          background: ${colors[i]};
          color: white;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          font-weight: 800;
          pointer-events: none;
          z-index: 99999;
          box-shadow: 0 2px 6px rgba(0,0,0,0.4);
          border: 2px solid white;
        `
        callout.textContent = String(i + 1)
        document.body.appendChild(callout)
      })
    })
    await window.waitForTimeout(300)
    await saveScreenshot(window, 'annotations')
    await clearHighlights(window)
  })

  test('12 - cohort view', async () => {
    // Highlight the Cohort button before clicking it
    const cohortBtn = window.locator('.mode-toggle .v-btn').nth(1)
    if (await cohortBtn.isVisible().catch(() => false)) {
      // Add highlight on the Cohort button in the top bar
      await addHighlight(window, '.mode-toggle', {
        label: 'Case / Cohort toggle',
        color: '#e74c3c'
      })
      await window.waitForTimeout(300)
      await clearHighlights(window)

      await cohortBtn.click()
      await window.waitForTimeout(1500)

      // Highlight the Cohort button (now active) after switching
      await addHighlight(window, '.mode-toggle', {
        label: 'Cohort mode active',
        color: '#e74c3c'
      })
    }

    await window.waitForTimeout(300)
    await saveScreenshot(window, 'cohort-view')
    await clearHighlights(window)

    // Switch back to case mode
    const caseBtn = window.locator('.mode-toggle .v-btn').nth(0)
    if (await caseBtn.isVisible().catch(() => false)) {
      await caseBtn.click()
      await window.waitForTimeout(1000)
    }
  })
})
