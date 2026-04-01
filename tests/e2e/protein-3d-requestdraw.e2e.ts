/**
 * Debug test - try requestDraw after setBgColor
 */
import { test, _electron as electron, type ElectronApplication } from '@playwright/test'

function launchApp(): Promise<ElectronApplication> {
  return electron.launch({
    args: ['./out/main/index.js'],
    env: { ...process.env, NODE_ENV: 'production' }
  })
}

// eslint-disable-next-line no-empty-pattern
test('debug: requestDraw after setBgColor', async ({}, testInfo) => {
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

    // Switch to surface
    const toolbar = window.locator('.structure-controls')
    await toolbar.locator('button:has-text("Surface")').click()
    await window.waitForTimeout(10000)

    await window.screenshot({ path: testInfo.outputPath('01-surface-before-fix.png') })

    // Try: setBgColor + requestDraw
    const result1 = await window.evaluate(() => {
      const el = document.querySelector('pdbe-molstar') as any
      if (!el?.viewerInstance) return 'no viewer'
      const vi = el.viewerInstance

      // Set bg color
      vi.canvas.setBgColor({ r: 250, g: 248, b: 246 })

      // Force a draw
      if (vi.plugin?.canvas3d?.requestDraw) {
        vi.plugin.canvas3d.requestDraw()
        return 'requestDraw called'
      }
      return 'no requestDraw'
    })
    await window.waitForTimeout(1000)
    await window.screenshot({ path: testInfo.outputPath('02-after-requestDraw.png') })

    // Try: directly set webgl clear color
    const result2 = await window.evaluate(() => {
      const el = document.querySelector('pdbe-molstar') as any
      if (!el?.viewerInstance?.plugin?.canvas3d?.webgl) return 'no webgl'
      const webgl = el.viewerInstance.plugin.canvas3d.webgl

      // Check what's in webgl
      const keys = Object.keys(webgl).slice(0, 30)

      // Try to find the gl context
      let glContext = null
      if (webgl.gl) glContext = webgl.gl
      else if (webgl.context) glContext = webgl.context

      if (glContext && glContext.clearColor) {
        glContext.clearColor(250 / 255, 248 / 255, 246 / 255, 1.0)
        glContext.clear(glContext.COLOR_BUFFER_BIT)
        return { action: 'clearColor set', keys }
      }

      return { keys, hasGl: !!webgl.gl, hasContext: !!webgl.context }
    })
    await window.waitForTimeout(500)
    await window.screenshot({ path: testInfo.outputPath('03-after-gl-clearColor.png') })

    // Try: commit on canvas3d
    const result3 = await window.evaluate(() => {
      const el = document.querySelector('pdbe-molstar') as any
      if (!el?.viewerInstance?.plugin?.canvas3d) return 'no canvas3d'
      const c3d = el.viewerInstance.plugin.canvas3d

      // Try setProps with force
      if (c3d.setProps) {
        c3d.setProps({
          renderer: {
            backgroundColor: { r: 0.98, g: 0.97, b: 0.96 }
          }
        })
      }

      // Try commit
      if (c3d.commit) {
        try {
          c3d.commit()
        } catch (e) {
          /* */
        }
      }

      // Try requestDraw with force flag
      if (c3d.requestDraw) {
        c3d.requestDraw(true)
      }

      return 'setProps + commit + requestDraw done'
    })
    await window.waitForTimeout(2000)
    await window.screenshot({ path: testInfo.outputPath('04-after-setProps-commit-draw.png') })

    const fs = await import('fs')
    fs.writeFileSync(
      testInfo.outputPath('results.json'),
      JSON.stringify({ result1, result2, result3 }, null, 2)
    )
  } finally {
    if (app) await app.close()
  }
})
