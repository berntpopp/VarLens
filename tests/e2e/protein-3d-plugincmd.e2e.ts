/**
 * Debug test - try PluginCommands.Canvas3D.SetSettings
 */
import { test, _electron as electron, type ElectronApplication } from '@playwright/test'

function launchApp(): Promise<ElectronApplication> {
  return electron.launch({
    args: ['./out/main/index.js'],
    env: { ...process.env, NODE_ENV: 'production' }
  })
}

// eslint-disable-next-line no-empty-pattern
test('debug: PluginCommands for bg color', async ({}, testInfo) => {
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

    // Switch to surface
    const toolbar = window.locator('.structure-controls')
    await toolbar.locator('button:has-text("Surface")').click()
    await window.waitForTimeout(10000)

    await window.screenshot({ path: testInfo.outputPath('01-surface-dark.png') })

    // Approach 1: Check the actual GL clear color
    const glInfo = await window.evaluate(() => {
      const el = document.querySelector('pdbe-molstar') as any
      const canvas = el?.querySelector('canvas')
      if (!canvas) return { error: 'no canvas' }
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
      if (!gl) return { error: 'no gl context' }
      const clearColor = gl.getParameter(gl.COLOR_CLEAR_VALUE)
      return {
        clearColor: Array.from(clearColor as Float32Array),
        drawingBufferWidth: gl.drawingBufferWidth,
        drawingBufferHeight: gl.drawingBufferHeight
      }
    })

    const fs = await import('fs')
    fs.writeFileSync(testInfo.outputPath('gl-clear-color.json'), JSON.stringify(glInfo, null, 2))

    // Approach 2: Try to navigate the plugin more carefully
    const pluginExplore = await window.evaluate(() => {
      const el = document.querySelector('pdbe-molstar') as any
      const vi = el?.viewerInstance
      if (!vi?.plugin) return { error: 'no plugin' }
      const plugin = vi.plugin

      // Check if there's a PluginCommands accessible
      const result: Record<string, unknown> = {}

      // Look at canvas3d more carefully
      if (plugin.canvas3d) {
        const c3d = plugin.canvas3d
        result.canvas3dHasSetProps = typeof c3d.setProps === 'function'

        // Get the actual renderer object
        if (c3d.props?.renderer) {
          const bgColor = c3d.props.renderer.backgroundColor
          result.propsBackgroundColor = bgColor
          // Check if it's a Color number
          result.bgColorType = typeof bgColor
        }

        // Check if there's a renderer that has the actual scene
        result.hasWebgl = !!c3d.webgl
        if (c3d.webgl?.gl) {
          const gl = c3d.webgl.gl
          const clearColor = gl.getParameter(gl.COLOR_CLEAR_VALUE)
          result.actualGlClearColor = Array.from(clearColor as Float32Array)
        }
      }

      // Try the pdbe-molstar plugin's `canvas` API internals
      if (vi.canvas) {
        result.canvasMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(vi.canvas) || {})
      }

      return result
    })

    fs.writeFileSync(testInfo.outputPath('plugin-explore.json'), JSON.stringify(pluginExplore, null, 2))

    // Approach 3: Set bg color and force a complete repaint by resizing
    await window.evaluate(() => {
      const el = document.querySelector('pdbe-molstar') as any
      const vi = el?.viewerInstance
      if (!vi) return

      // Set bg color via canvas API
      vi.canvas.setBgColor({ r: 250, g: 248, b: 246 })

      // Force a resize event which triggers a full redraw
      if (vi.plugin?.canvas3d?.handleResize) {
        vi.plugin.canvas3d.handleResize()
      }
    })
    await window.waitForTimeout(2000)
    await window.screenshot({ path: testInfo.outputPath('02-after-resize.png') })

    // Approach 4: Try visual.reset with theme:true then re-highlight
    await window.evaluate(() => {
      const el = document.querySelector('pdbe-molstar') as any
      const vi = el?.viewerInstance
      if (!vi) return

      vi.canvas.setBgColor({ r: 250, g: 248, b: 246 })
      vi.visual.reset({ camera: false, theme: true })
    })
    await window.waitForTimeout(2000)
    await window.screenshot({ path: testInfo.outputPath('03-after-theme-reset.png') })

  } finally {
    if (app) await app.close()
  }
})
