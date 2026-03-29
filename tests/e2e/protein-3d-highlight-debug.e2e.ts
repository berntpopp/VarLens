/**
 * Debug: does highlightVariants cause the dark background?
 */
import { test, _electron as electron, type ElectronApplication } from '@playwright/test'

function launchApp(): Promise<ElectronApplication> {
  return electron.launch({
    args: ['./out/main/index.js'],
    env: { ...process.env, NODE_ENV: 'production' }
  })
}

// eslint-disable-next-line no-empty-pattern
test('debug: highlight causes dark bg', async ({}, testInfo) => {
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

    // Screenshot cartoon with highlights
    await window.screenshot({ path: testInfo.outputPath('01-cartoon-with-highlights.png') })

    // Now manually create a fresh surface element without calling visual.select()
    await window.evaluate(() => {
      const el = document.querySelector('pdbe-molstar') as HTMLElement
      if (!el) return
      const parent = el.parentElement
      if (!parent) return

      const customDataUrl = el.getAttribute('custom-data-url')
      const customDataFormat = el.getAttribute('custom-data-format') || 'cif'

      parent.removeChild(el)

      const newEl = document.createElement('pdbe-molstar') as any
      newEl.setAttribute('custom-data-url', customDataUrl)
      newEl.setAttribute('custom-data-format', customDataFormat)
      newEl.setAttribute('visual-style', 'molecular-surface')
      newEl.setAttribute('hide-controls', 'true')
      newEl.setAttribute('landscape', 'true')
      newEl.setAttribute('bg-color-r', '250')
      newEl.setAttribute('bg-color-g', '248')
      newEl.setAttribute('bg-color-b', '246')
      newEl.style.width = '100%'
      newEl.style.height = '100%'
      newEl.style.display = 'block'

      parent.appendChild(newEl)
    })
    await window.waitForTimeout(15000)

    // Screenshot: fresh surface WITHOUT visual.select()
    await window.screenshot({ path: testInfo.outputPath('02-fresh-surface-no-highlight.png') })

    // Now call visual.select() with variant highlighting
    const selectResult = await window.evaluate(() => {
      const el = document.querySelector('pdbe-molstar') as any
      if (!el?.viewerInstance) return 'no viewer'

      el.viewerInstance.visual.select({
        data: [
          {
            struct_asym_id: 'A',
            start_residue_number: 1400,
            end_residue_number: 1400,
            color: { r: 255, g: 0, b: 0 },
            focus: false,
            sideChain: true
          }
        ],
        nonSelectedColor: { r: 220, g: 220, b: 220 }
      })

      return 'select called'
    })

    const fs = await import('fs')
    fs.writeFileSync(testInfo.outputPath('select-result.json'), JSON.stringify({ selectResult }, null, 2))

    await window.waitForTimeout(3000)

    // Screenshot: surface WITH visual.select()
    await window.screenshot({ path: testInfo.outputPath('03-surface-after-select.png') })

  } finally {
    if (app) await app.close()
  }
})
