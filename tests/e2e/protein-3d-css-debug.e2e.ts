/**
 * Debug test - check CSS backgrounds in the molstar element
 */
import { test, _electron as electron, type ElectronApplication } from '@playwright/test'

function launchApp(): Promise<ElectronApplication> {
  return electron.launch({
    args: ['./out/main/index.js'],
    env: { ...process.env, NODE_ENV: 'production' }
  })
}

// eslint-disable-next-line no-empty-pattern
test('debug: CSS backgrounds in molstar', async ({}, testInfo) => {
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

    // Screenshot before surface
    await window.screenshot({ path: testInfo.outputPath('01-cartoon-before.png') })

    // Get CSS of all elements inside pdbe-molstar
    const cssInfo = await window.evaluate(() => {
      const el = document.querySelector('pdbe-molstar')
      if (!el) return { error: 'no element' }

      const result: Array<{tag: string, classes: string, bg: string, width: string, height: string}> = []
      const children = el.querySelectorAll('*')
      for (let i = 0; i < Math.min(children.length, 50); i++) {
        const child = children[i]
        const style = window.getComputedStyle(child)
        const bg = style.backgroundColor
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
          result.push({
            tag: child.tagName,
            classes: child.className?.toString().slice(0, 80) || '',
            bg,
            width: style.width,
            height: style.height
          })
        }
      }
      return result
    })

    const fs = await import('fs')
    fs.writeFileSync(testInfo.outputPath('01-cartoon-css.json'), JSON.stringify(cssInfo, null, 2))

    // Switch to surface
    const toolbar = window.locator('.structure-controls')
    await toolbar.locator('button:has-text("Surface")').click()
    await window.waitForTimeout(10000)

    await window.screenshot({ path: testInfo.outputPath('02-surface.png') })

    // Get CSS after surface
    const cssInfoSurface = await window.evaluate(() => {
      const el = document.querySelector('pdbe-molstar')
      if (!el) return { error: 'no element' }

      const result: Array<{tag: string, classes: string, bg: string, width: string, height: string}> = []
      const children = el.querySelectorAll('*')
      for (let i = 0; i < Math.min(children.length, 50); i++) {
        const child = children[i]
        const style = window.getComputedStyle(child)
        const bg = style.backgroundColor
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
          result.push({
            tag: child.tagName,
            classes: child.className?.toString().slice(0, 80) || '',
            bg,
            width: style.width,
            height: style.height
          })
        }
      }

      // Also check the pdbe-molstar element itself
      const elStyle = window.getComputedStyle(el)
      result.unshift({
        tag: 'PDBE-MOLSTAR',
        classes: '',
        bg: elStyle.backgroundColor,
        width: elStyle.width,
        height: elStyle.height
      })

      return result
    })

    fs.writeFileSync(testInfo.outputPath('02-surface-css.json'), JSON.stringify(cssInfoSurface, null, 2))

    // Try forcibly setting background on all dark elements
    await window.evaluate(() => {
      const el = document.querySelector('pdbe-molstar')
      if (!el) return
      const bgColor = 'rgb(250, 248, 246)'

      // Set on the element itself
      ;(el as HTMLElement).style.backgroundColor = bgColor

      // Set on all divs inside
      const divs = el.querySelectorAll('div')
      divs.forEach(div => {
        const style = window.getComputedStyle(div)
        const bg = style.backgroundColor
        // If it's dark (low RGB values), override it
        const match = bg.match(/rgb\((\d+), (\d+), (\d+)\)/)
        if (match) {
          const r = parseInt(match[1])
          const g = parseInt(match[2])
          const b = parseInt(match[3])
          if (r < 100 && g < 100 && b < 100) {
            div.style.backgroundColor = bgColor
          }
        }
      })
    })
    await window.waitForTimeout(500)

    await window.screenshot({ path: testInfo.outputPath('03-surface-css-override.png') })

  } finally {
    if (app) await app.close()
  }
})
