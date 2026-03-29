/**
 * Debug: verify element recreation via key change
 */
import { test, _electron as electron, type ElectronApplication } from '@playwright/test'

function launchApp(): Promise<ElectronApplication> {
  return electron.launch({
    args: ['./out/main/index.js'],
    env: { ...process.env, NODE_ENV: 'production' }
  })
}

// eslint-disable-next-line no-empty-pattern
test('debug: verify element recreation', async ({}, testInfo) => {
  test.setTimeout(120_000)
  let app: ElectronApplication | undefined

  try {
    app = await launchApp()
    const window = await app.firstWindow()
    await window.waitForSelector('.v-application', { timeout: 15000 })

    const disclaimerBtn = window.locator('button:has-text("I Understand")')
    if ((await disclaimerBtn.count()) > 0) {
      await disclaimerBtn.click()
      await window.waitForTimeout(500)
    }

    await window.locator('.v-list-item').first().click()
    await window.waitForTimeout(2000)
    await window.locator('.v-data-table tbody tr').first().click()
    await window.waitForTimeout(1500)

    const proteinBtn = window.locator('[aria-label="Open protein view"]')
    if ((await proteinBtn.count()) === 0) { test.skip(true, 'no btn'); return }
    await proteinBtn.first().click()
    await window.waitForTimeout(3000)

    const structureTab = window.locator('button:has-text("3D Structure")')
    if ((await structureTab.count()) > 0) {
      await structureTab.click()
      await window.waitForTimeout(8000)
    }

    // Mark the current pdbe-molstar element
    await window.evaluate(() => {
      const el = document.querySelector('pdbe-molstar')
      if (el) (el as any).__testMarker = 'original'
    })

    // Get current visual-style attribute
    const beforeInfo = await window.evaluate(() => {
      const el = document.querySelector('pdbe-molstar')
      if (!el) return null
      return {
        visualStyle: el.getAttribute('visual-style'),
        marker: (el as any).__testMarker,
        bgR: el.getAttribute('bg-color-r'),
        bgG: el.getAttribute('bg-color-g'),
        bgB: el.getAttribute('bg-color-b')
      }
    })

    const fs = await import('fs')
    fs.writeFileSync(testInfo.outputPath('before.json'), JSON.stringify(beforeInfo, null, 2))

    // Click Surface
    const toolbar = window.locator('.structure-controls')
    await toolbar.locator('button:has-text("Surface")').click()
    await window.waitForTimeout(12000)

    // Check if element was recreated
    const afterInfo = await window.evaluate(() => {
      const el = document.querySelector('pdbe-molstar')
      if (!el) return null
      return {
        visualStyle: el.getAttribute('visual-style'),
        marker: (el as any).__testMarker,
        bgR: el.getAttribute('bg-color-r'),
        bgG: el.getAttribute('bg-color-g'),
        bgB: el.getAttribute('bg-color-b'),
        isNewElement: (el as any).__testMarker !== 'original'
      }
    })

    fs.writeFileSync(testInfo.outputPath('after.json'), JSON.stringify(afterInfo, null, 2))

    await window.screenshot({ path: testInfo.outputPath('surface.png') })

  } finally {
    if (app) await app.close()
  }
})
