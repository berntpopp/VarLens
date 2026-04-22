import { test, expect } from '@playwright/test'
import {
  type LaunchPackagedAppResult,
  launchPackagedLinuxApp
} from './helpers/packaged-electron-app'
import { ensureArtifactDir, writeJsonArtifact } from './helpers/perf-artifacts'

// NOTE: Playwright's `_electron.launch({ executablePath })` cannot be used for
// fuse-hardened binaries because it injects `--inspect=0`, which is blocked by
// `EnableNodeCliInspectArguments: false`.  We verify boot by spawning the
// binary directly and waiting for the "IPC handlers registered" log line.
test('packaged Linux binary boots with fuses flipped', async ({}, testInfo) => {
  ensureArtifactDir('packaged-smoke')
  test.setTimeout(60_000)

  let launched: LaunchPackagedAppResult | undefined
  const launchStartedAt = Date.now()

  try {
    launched = await launchPackagedLinuxApp(/IPC handlers registered/, 30_000)

    // The app emitted the ready line — confirm no crash-indicating patterns
    const crashLines = launched.collectedLines.filter((l) =>
      /native module.*mismatch|ERR_MODULE_NOT_FOUND|FATAL|Segmentation fault/i.test(l)
    )
    expect(crashLines, `Crash indicators in output: ${crashLines.join('\n')}`).toHaveLength(0)

    writeJsonArtifact('packaged-smoke/launch-context.json', {
      isolationRoot: launched.isolationRoot,
      executablePath: launched.executablePath,
      elapsedMs: Date.now() - launchStartedAt,
      collectedLines: launched.collectedLines
    })
  } catch (error) {
    writeJsonArtifact('packaged-smoke/failure-context.json', {
      message: error instanceof Error ? error.message : String(error),
      launchElapsedMs: Date.now() - launchStartedAt,
      collectedLines: launched?.collectedLines ?? [],
      testOutputDir: testInfo.outputDir
    })
    throw error
  } finally {
    if (launched !== undefined) {
      await launched.cleanup()
    }
  }
})
