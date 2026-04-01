/**
 * Debug test for 3D protein structure viewer background color
 */
import { test, _electron as electron, type ElectronApplication } from '@playwright/test'

function launchApp(): Promise<ElectronApplication> {
  return electron.launch({
    args: ['./out/main/index.js'],
    env: { ...process.env, NODE_ENV: 'production' }
  })
}

// eslint-disable-next-line no-empty-pattern
test('debug: inspect molstar viewer instance', async ({}, testInfo) => {
  test.setTimeout(120_000)
  let app: ElectronApplication | undefined

  try {
    app = await launchApp()
    const window = await app.firstWindow()
    await window.waitForSelector('.v-application', { timeout: 15000 })

    // Dismiss disclaimer
    const disclaimerBtn = window.locator('button:has-text("I Understand")')
    if ((await disclaimerBtn.count()) > 0) {
      await disclaimerBtn.click()
      await window.waitForTimeout(500)
    }

    // Click first case
    const caseItem = window.locator('.v-list-item').first()
    await caseItem.click()
    await window.waitForTimeout(2000)

    // Click first variant
    const variantRow = window.locator('.v-data-table tbody tr').first()
    await variantRow.click()
    await window.waitForTimeout(1500)

    // Open protein view
    const proteinBtn = window.locator('[aria-label="Open protein view"]')
    if ((await proteinBtn.count()) === 0) {
      test.skip(true, 'No protein view button')
      return
    }
    await proteinBtn.first().click()
    await window.waitForTimeout(3000)

    // Click 3D Structure tab
    const structureTab = window.locator('button:has-text("3D Structure")')
    if ((await structureTab.count()) > 0) {
      await structureTab.click()
      await window.waitForTimeout(8000)
    }

    // Debug: inspect the molstar viewer instance
    const debugInfo = await window.evaluate(() => {
      const el = document.querySelector('pdbe-molstar') as any
      if (!el) return { error: 'no pdbe-molstar element' }
      const vi = el.viewerInstance
      if (!vi) return { error: 'no viewerInstance' }

      const result: Record<string, unknown> = {}

      // Check canvas API
      result.hasCanvas = !!vi.canvas
      result.canvasKeys = vi.canvas ? Object.keys(vi.canvas) : []

      // Check plugin
      result.hasPlugin = !!vi.plugin
      if (vi.plugin) {
        result.pluginKeys = Object.keys(vi.plugin).slice(0, 20)
        result.hasCanvas3d = !!vi.plugin.canvas3d
        if (vi.plugin.canvas3d) {
          result.canvas3dKeys = Object.keys(vi.plugin.canvas3d).slice(0, 20)
          // Try to get current props
          if (vi.plugin.canvas3d.props) {
            const props = vi.plugin.canvas3d.props
            result.rendererKeys = props.renderer ? Object.keys(props.renderer).slice(0, 20) : []
            result.currentBgColor = props.renderer?.backgroundColor
          }
        }
      }

      // Try setBgColor and see what happens
      try {
        vi.canvas.setBgColor({ r: 250, g: 248, b: 246 })
        result.setBgColorSuccess = true
      } catch (e: any) {
        result.setBgColorError = e.message
      }

      return result
    })

    // Write debug info as text file
    const fs = await import('fs')
    fs.writeFileSync(testInfo.outputPath('debug-info.json'), JSON.stringify(debugInfo, null, 2))

    // Now switch to Surface
    const toolbar = window.locator('.structure-controls')
    const surfaceBtn = toolbar.locator('button:has-text("Surface")')
    if ((await surfaceBtn.count()) > 0) {
      await surfaceBtn.click()
      await window.waitForTimeout(10000)
    }

    // Check bg color state after surface switch
    const afterSurface = await window.evaluate(() => {
      const el = document.querySelector('pdbe-molstar') as any
      if (!el?.viewerInstance?.plugin?.canvas3d?.props) return { error: 'no props' }
      const props = el.viewerInstance.plugin.canvas3d.props
      return {
        backgroundColor: props.renderer?.backgroundColor,
        clearColor: props.renderer?.clearColor
      }
    })

    const fs2 = await import('fs')
    fs2.writeFileSync(
      testInfo.outputPath('after-surface.json'),
      JSON.stringify(afterSurface, null, 2)
    )

    // Try to set bg color via plugin canvas3d directly
    await window.evaluate(() => {
      const el = document.querySelector('pdbe-molstar') as any
      if (!el?.viewerInstance?.plugin?.canvas3d?.setProps) return
      el.viewerInstance.plugin.canvas3d.setProps({
        renderer: {
          backgroundColor: { r: 0.98, g: 0.97, b: 0.96 }
        }
      })
    })
    await window.waitForTimeout(1000)

    await window.screenshot({ path: testInfo.outputPath('surface-after-manual-setProps.png') })

    // Also try using canvas.setBgColor
    await window.evaluate(() => {
      const el = document.querySelector('pdbe-molstar') as any
      if (!el?.viewerInstance?.canvas) return
      el.viewerInstance.canvas.setBgColor({ r: 250, g: 248, b: 246 })
    })
    await window.waitForTimeout(1000)

    await window.screenshot({ path: testInfo.outputPath('surface-after-setBgColor.png') })
  } finally {
    if (app) await app.close()
  }
})
