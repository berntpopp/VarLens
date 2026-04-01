/**
 * Debug: check canvas context attributes and rendering behavior
 */
import { test, _electron as electron, type ElectronApplication } from '@playwright/test'

function launchApp(): Promise<ElectronApplication> {
  return electron.launch({
    args: ['./out/main/index.js'],
    env: { ...process.env, NODE_ENV: 'production' }
  })
}

// eslint-disable-next-line no-empty-pattern
test('debug: canvas context attributes', async ({}, testInfo) => {
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

    // Get canvas info
    const canvasInfo = await window.evaluate(() => {
      const el = document.querySelector('pdbe-molstar') as any
      const canvas = el?.querySelector('canvas') as HTMLCanvasElement
      if (!canvas) return { error: 'no canvas' }

      // Try getting existing context (don't create new one)
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
      const attrs = gl?.getContextAttributes()

      // Sample some pixels from the canvas background area
      // Read pixels from a corner where there's no molecule
      let cornerPixels = null
      if (gl) {
        const pixels = new Uint8Array(4)
        gl.readPixels(5, 5, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
        cornerPixels = Array.from(pixels)
      }

      // Check canvas CSS
      const style = window.getComputedStyle(canvas)

      return {
        width: canvas.width,
        height: canvas.height,
        cssWidth: style.width,
        cssHeight: style.height,
        cssBg: style.backgroundColor,
        contextAttrs: attrs,
        cornerPixels,
        canvasStyle: canvas.getAttribute('style')
      }
    })

    const fs = await import('fs')
    fs.writeFileSync(
      testInfo.outputPath('cartoon-canvas-info.json'),
      JSON.stringify(canvasInfo, null, 2)
    )

    // Screenshot cartoon - read pixel from corner
    await window.screenshot({ path: testInfo.outputPath('01-cartoon.png') })

    // Switch to surface
    const toolbar = window.locator('.structure-controls')
    await toolbar.locator('button:has-text("Surface")').click()
    await window.waitForTimeout(12000)

    // Get surface canvas info
    const surfaceCanvasInfo = await window.evaluate(() => {
      const el = document.querySelector('pdbe-molstar') as any
      const canvas = el?.querySelector('canvas') as HTMLCanvasElement
      if (!canvas) return { error: 'no canvas' }
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
      const attrs = gl?.getContextAttributes()

      let cornerPixels = null
      let centerPixels = null
      if (gl) {
        const pixels = new Uint8Array(4)
        gl.readPixels(5, 5, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
        cornerPixels = Array.from(pixels)

        // Read from where the dark bg is visible
        const pixels2 = new Uint8Array(4)
        gl.readPixels(50, 50, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels2)
        centerPixels = Array.from(pixels2)
      }

      return {
        contextAttrs: attrs,
        cornerPixels,
        centerPixels,
        // Check the renderer's actual bgColor Vec3
        rendererBgVec: (() => {
          try {
            const c3d = el?.viewerInstance?.plugin?.canvas3d
            // Access the renderer pass
            if (c3d?.props?.renderer?.backgroundColor) {
              return c3d.props.renderer.backgroundColor
            }
          } catch {
            return null
          }
          return null
        })()
      }
    })

    fs.writeFileSync(
      testInfo.outputPath('surface-canvas-info.json'),
      JSON.stringify(surfaceCanvasInfo, null, 2)
    )

    await window.screenshot({ path: testInfo.outputPath('02-surface.png') })

    // KEY TEST: Check if the molecule renders with proper bg via Mol*'s internal draw
    // The Mol* renderer draws the bg color itself in its render pass, not via clearColor
    // This means the renderer needs to be told to use our bg color
    // Let's try: directly modify the canvas3d setProps with the full nested path
    const setPropsResult = await window.evaluate(() => {
      const el = document.querySelector('pdbe-molstar') as any
      const c3d = el?.viewerInstance?.plugin?.canvas3d
      if (!c3d) return 'no canvas3d'

      // Get current props
      const currentRenderer = { ...c3d.props.renderer }

      // Set background color as a Mol* Color integer
      // Color is stored as 0xRRGGBB integer in Mol*
      const colorInt = (250 << 16) | (248 << 8) | 246 // 0xFAF8F6 = 16447734
      currentRenderer.backgroundColor = colorInt

      // Use setProps with the full renderer config
      c3d.setProps({ renderer: currentRenderer })

      // Force redraw
      c3d.requestDraw(true)

      // Check if it took effect
      const newBg = c3d.props.renderer.backgroundColor
      return { colorInt, newBg, match: colorInt === newBg }
    })
    fs.writeFileSync(
      testInfo.outputPath('setProps-result.json'),
      JSON.stringify(setPropsResult, null, 2)
    )

    await window.waitForTimeout(2000)
    await window.screenshot({ path: testInfo.outputPath('03-after-full-setProps.png') })
  } finally {
    if (app) await app.close()
  }
})
