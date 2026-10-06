import { test, expect } from '@playwright/test'
import {
  type LaunchElectronAppResult,
  dismissDisclaimerIfPresent,
  launchElectronApp,
  waitForAppShell
} from './helpers/electron-app'
import { ensureArtifactDir, writeJsonArtifact } from './helpers/perf-artifacts'

test('startup smoke launches the app shell with isolated Electron state', async ({}, testInfo) => {
  const startupArtifactDir = ensureArtifactDir('startup-smoke')
  test.setTimeout(process.env.CI === 'true' ? 120_000 : 45_000)

  let launched: LaunchElectronAppResult | undefined
  const launchStartedAt = Date.now()

  try {
    launched = await launchElectronApp({ perfMode: true })
    await waitForAppShell(launched.window)
    await dismissDisclaimerIfPresent(launched.window)

    await expect(launched.window.locator('.v-app-bar')).toBeVisible()
    await expect(launched.window.locator('.v-footer')).toBeVisible()

    const snapshot = await launched.window.evaluate(async () => {
      return window.api.perf.getSnapshot()
    })

    expect(snapshot.main.milestones['app-ready']).toBeGreaterThanOrEqual(0)
    expect(snapshot.main.milestones['window-created']).toBeGreaterThanOrEqual(0)
    expect(snapshot.main.milestones['renderer-interactive']).toBeGreaterThanOrEqual(0)
    // Window first, database second (audit 05, M-6).
    expect(snapshot.main.milestones['database-ready']).toBeGreaterThanOrEqual(
      snapshot.main.milestones['window-created']
    )

    await launched.window.screenshot({
      path: `${startupArtifactDir}/app-shell.png`
    })

    writeJsonArtifact('startup-smoke/launch-context.json', {
      isolationRoot: launched.isolationRoot,
      userDataDir: launched.userDataDir,
      appDataDir: launched.appDataDir,
      consoleMessages: launched.consoleMessages
    })
    writeJsonArtifact('startup-smoke/perf-snapshot.json', snapshot)
  } catch (error) {
    if (launched !== undefined) {
      await launched.window.screenshot({
        path: `${startupArtifactDir}/failure.png`
      })
    }

    writeJsonArtifact('startup-smoke/failure-context.json', {
      message: error instanceof Error ? error.message : String(error),
      launchElapsedMs: Date.now() - launchStartedAt,
      launchedWindow: launched !== undefined,
      consoleMessages: launched?.consoleMessages ?? [],
      testOutputDir: testInfo.outputDir
    })
    throw error
  } finally {
    if (launched !== undefined) {
      await launched.cleanup()
    }
  }
})
