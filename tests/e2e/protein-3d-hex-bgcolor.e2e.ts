/**
 * Debug test - try different bgColor formats and timing
 */
import { test, _electron as electron, type ElectronApplication } from '@playwright/test'

function launchApp(): Promise<ElectronApplication> {
  return electron.launch({
    args: ['./out/main/index.js'],
    env: { ...process.env, NODE_ENV: 'production' }
  })
}

// eslint-disable-next-line no-empty-pattern
test('debug: hex bgColor format', async ({}, testInfo) => {
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

    // Before switching: check if initial cartoon has correct GL clear color
    const initialGl = await window.evaluate(() => {
      const el = document.querySelector('pdbe-molstar') as any
      const canvas = el?.querySelector('canvas')
      const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl')
      if (!gl) return null
      return Array.from(gl.getParameter(gl.COLOR_CLEAR_VALUE) as Float32Array)
    })

    const fs = await import('fs')
    fs.writeFileSync(testInfo.outputPath('initial-gl.json'), JSON.stringify({ initialGl }, null, 2))

    // Use visual.update with bgColor as hex string
    await window.evaluate(() => {
      const el = document.querySelector('pdbe-molstar') as any
      const vi = el?.viewerInstance
      if (!vi) return

      const customDataUrl = el.getAttribute('custom-data-url')
      const customDataFormat = el.getAttribute('custom-data-format') || 'cif'

      vi.visual.update(
        {
          visualStyle: 'molecular-surface',
          bgColor: '#faf8f6',
          customData: { url: customDataUrl, format: customDataFormat }
        },
        true
      )
    })
    await window.waitForTimeout(12000)

    await window.screenshot({ path: testInfo.outputPath('01-surface-hex-bgcolor.png') })

    // Check GL clear color after load
    const afterGl = await window.evaluate(() => {
      const el = document.querySelector('pdbe-molstar') as any
      const canvas = el?.querySelector('canvas')
      const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl')
      if (!gl) return null
      return Array.from(gl.getParameter(gl.COLOR_CLEAR_VALUE) as Float32Array)
    })
    fs.writeFileSync(testInfo.outputPath('after-gl.json'), JSON.stringify({ afterGl }, null, 2))

    // Also try: rebuild by updating the element attributes and triggering re-render
    // Set all bg-color attrs before update
    await window.evaluate(() => {
      const el = document.querySelector('pdbe-molstar') as any
      el.setAttribute('bg-color-r', '250')
      el.setAttribute('bg-color-g', '248')
      el.setAttribute('bg-color-b', '246')
    })

    // Now try visual.update without fullLoad
    await window.evaluate(() => {
      const el = document.querySelector('pdbe-molstar') as any
      const vi = el?.viewerInstance
      if (!vi) return
      vi.visual.update({ bgColor: '#faf8f6' }, false)
    })
    await window.waitForTimeout(3000)

    await window.screenshot({ path: testInfo.outputPath('02-after-bgonly-update.png') })

    const afterBgOnlyGl = await window.evaluate(() => {
      const el = document.querySelector('pdbe-molstar') as any
      const canvas = el?.querySelector('canvas')
      const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl')
      if (!gl) return null
      return Array.from(gl.getParameter(gl.COLOR_CLEAR_VALUE) as Float32Array)
    })
    fs.writeFileSync(
      testInfo.outputPath('after-bgonly-gl.json'),
      JSON.stringify({ afterBgOnlyGl }, null, 2)
    )

    // Try: setProps on the renderer directly
    await window.evaluate(() => {
      const el = document.querySelector('pdbe-molstar') as any
      const vi = el?.viewerInstance
      if (!vi?.plugin?.canvas3d) return

      // Access the actual renderer
      const c3d = vi.plugin.canvas3d
      // Try getting the renderer from the scene
      const keys = Object.keys(c3d)
      // @ts-ignore - accessing internal
      const renderer = c3d.renderer || c3d._renderer
      if (renderer?.setProps) {
        renderer.setProps({ backgroundColor: 0xfaf8f6 })
      }
    })
    await window.waitForTimeout(1000)

    const afterRendererGl = await window.evaluate(() => {
      const el = document.querySelector('pdbe-molstar') as any
      const canvas = el?.querySelector('canvas')
      const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl')
      if (!gl) return null
      const clearColor = Array.from(gl.getParameter(gl.COLOR_CLEAR_VALUE) as Float32Array)
      // Also get canvas3d keys to find renderer
      const c3d = el?.viewerInstance?.plugin?.canvas3d
      const c3dKeys = c3d ? Object.keys(c3d) : []
      return { clearColor, c3dKeys }
    })
    fs.writeFileSync(
      testInfo.outputPath('after-renderer-gl.json'),
      JSON.stringify(afterRendererGl, null, 2)
    )

    await window.screenshot({ path: testInfo.outputPath('03-after-renderer-setProps.png') })
  } finally {
    if (app) await app.close()
  }
})
