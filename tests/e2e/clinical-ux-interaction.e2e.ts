import { test, expect } from '@playwright/test'
import {
  type LaunchElectronAppResult,
  dismissDisclaimerIfPresent,
  launchElectronApp,
  waitForAppShell
} from './helpers/electron-app'

test('clinical UX interaction verification', async () => {
  test.setTimeout(process.env.CI === 'true' ? 120_000 : 45_000)

  let launched: LaunchElectronAppResult | undefined

  try {
    launched = await launchElectronApp({ perfMode: true })
    await waitForAppShell(launched.window)
    await dismissDisclaimerIfPresent(launched.window)

    // Verify App Bar & Footer exist and adhere to clinical layout
    await expect(launched.window.locator('.v-app-bar')).toBeVisible()
    await expect(launched.window.locator('.v-footer')).toBeVisible()

    // Verify database picker / empty state or case view loads
    const mainContent = launched.window.locator('.v-main')
    await expect(mainContent).toBeVisible()

    // Test Escape key handling does not crash or cause unhandled rejections
    await launched.window.keyboard.press('Escape')
    await launched.window.waitForTimeout(100)

    // Test Arrow key events
    await launched.window.keyboard.press('ArrowDown')
    await launched.window.keyboard.press('ArrowUp')
    await launched.window.waitForTimeout(100)

    // Verify no fatal uncaught errors occurred in console
    const criticalErrors = launched.consoleMessages.filter((msg) =>
      msg.toLowerCase().includes('uncaught error')
    )
    expect(criticalErrors).toHaveLength(0)
  } finally {
    if (launched !== undefined) {
      await launched.cleanup()
    }
  }
})
