/**
 * Debug test - try double update approach
 */
import { test, _electron as electron, type ElectronApplication } from '@playwright/test'

function launchApp(): Promise<ElectronApplication> {
  return electron.launch({
    args: ['./out/main/index.js'],
    env: { ...process.env, NODE_ENV: 'production' }
  })
}

// eslint-disable-next-line no-empty-pattern
test('debug: double update for bg color', async ({}, testInfo) => {
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
    if ((await proteinBtn.count()) === 0) {
      test.skip(true, 'no btn')
      return
    }
    await proteinBtn.first().click()
    await window.waitForTimeout(3000)

    const structureTab = window.locator('button:has-text("3D Structure")')
    if ((await structureTab.count()) > 0) {
      await structureTab.click()
      await window.waitForTimeout(8000)
    }

    // Screenshot cartoon
    await window.screenshot({ path: testInfo.outputPath('01-cartoon.png') })

    // Strategy: Switch to surface via visual.update, then after load do another
    // update with JUST bgColor and fullLoad=false
    await window.evaluate(() => {
      const el = document.querySelector('pdbe-molstar') as any
      const vi = el?.viewerInstance
      if (!vi) return

      const customDataUrl = el.getAttribute('custom-data-url')
      const customDataFormat = el.getAttribute('custom-data-format') || 'cif'

      // First update: change visual style with fullLoad
      vi.visual.update(
        {
          visualStyle: 'molecular-surface',
          bgColor: { r: 250, g: 248, b: 246 },
          customData: { url: customDataUrl, format: customDataFormat }
        },
        true
      )
    })
    await window.waitForTimeout(12000)

    await window.screenshot({ path: testInfo.outputPath('02-surface-after-first-update.png') })

    // Second update: just bgColor, no fullLoad
    await window.evaluate(() => {
      const el = document.querySelector('pdbe-molstar') as any
      const vi = el?.viewerInstance
      if (!vi) return
      vi.visual.update(
        {
          bgColor: { r: 250, g: 248, b: 246 }
        },
        false
      )
    })
    await window.waitForTimeout(3000)

    await window.screenshot({ path: testInfo.outputPath('03-surface-after-bg-update.png') })

    // Strategy 2: Re-set element attributes and trigger attribute observation
    await window.evaluate(() => {
      const el = document.querySelector('pdbe-molstar') as any
      // Toggle bg-color attributes to trigger a MutationObserver
      el.setAttribute('bg-color-r', '249')
      el.setAttribute('bg-color-g', '247')
      el.setAttribute('bg-color-b', '245')
    })
    await window.waitForTimeout(1000)
    await window.evaluate(() => {
      const el = document.querySelector('pdbe-molstar') as any
      el.setAttribute('bg-color-r', '250')
      el.setAttribute('bg-color-g', '248')
      el.setAttribute('bg-color-b', '246')
    })
    await window.waitForTimeout(2000)

    await window.screenshot({ path: testInfo.outputPath('04-after-attr-toggle.png') })

    // Strategy 3: Remove and re-add the pdbe-molstar element entirely
    // This is a nuclear option but would test if a fresh element works
    const reAddResult = await window.evaluate(async () => {
      const el = document.querySelector('pdbe-molstar') as HTMLElement
      if (!el) return 'no element'
      const parent = el.parentElement
      if (!parent) return 'no parent'

      // Clone the element's attributes
      const attrs: Record<string, string> = {}
      for (const attr of Array.from(el.attributes)) {
        attrs[attr.name] = attr.value
      }

      // Remove old element
      parent.removeChild(el)

      // Create new element with surface style
      const newEl = document.createElement('pdbe-molstar')
      for (const [key, value] of Object.entries(attrs)) {
        newEl.setAttribute(key, value)
      }
      newEl.setAttribute('visual-style', 'molecular-surface')
      newEl.setAttribute('bg-color-r', '250')
      newEl.setAttribute('bg-color-g', '248')
      newEl.setAttribute('bg-color-b', '246')
      newEl.style.width = '100%'
      newEl.style.height = '100%'
      newEl.style.display = 'block'

      parent.appendChild(newEl)
      return 'element replaced'
    })
    const fs = await import('fs')
    fs.writeFileSync(
      testInfo.outputPath('re-add-result.json'),
      JSON.stringify({ reAddResult }, null, 2)
    )

    // Wait for the new element to load
    await window.waitForTimeout(15000)

    await window.screenshot({ path: testInfo.outputPath('05-fresh-element-surface.png') })
  } finally {
    if (app) await app.close()
  }
})
