import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { spawn } from 'child_process'

export interface LaunchPackagedAppResult {
  isolationRoot: string
  userDataDir: string
  appDataDir: string
  executablePath: string
  collectedLines: string[]
  cleanup: () => Promise<void>
}

export function resolveLinuxPackagedBinary(projectRoot: string = process.cwd()): string {
  const releaseDir = resolve(projectRoot, 'release')
  if (!existsSync(releaseDir)) {
    throw new Error(
      `release/ does not exist at ${releaseDir} — run 'make dist-linux' before the packaged smoke test.`
    )
  }
  // Prefer the unpacked binary: fuses are already applied (it is the binary
  // that gets wrapped into the AppImage), and it launches without requiring
  // libfuse2 — which is often missing on CI runners and minimal containers.
  const unpackedBinary = join(releaseDir, 'linux-unpacked', 'varlens')
  if (existsSync(unpackedBinary)) {
    return unpackedBinary
  }
  throw new Error(
    `Expected ${unpackedBinary} to exist after 'make dist-linux'. Contents of ${releaseDir}: ${readdirSync(releaseDir).join(', ') || '(empty)'}`
  )
}

/**
 * Launches the packaged Linux binary as a child process and waits until the
 * app emits a known "ready" log line (or the timeout elapses).
 *
 * NOTE: Playwright's `_electron.launch({ executablePath })` cannot be used
 * here because it injects `--inspect=0`, which is blocked by the hardened
 * `EnableNodeCliInspectArguments: false` fuse.  A direct spawn is the only
 * reliable way to smoke-test a fuse-hardened Electron binary.
 */
export async function launchPackagedLinuxApp(
  readyPattern: RegExp = /IPC handlers registered/,
  timeoutMs: number = 30_000
): Promise<LaunchPackagedAppResult> {
  const executablePath = resolveLinuxPackagedBinary()

  const isolationRoot = mkdtempSync(join(tmpdir(), 'varlens-packaged-'))
  const userDataDir = join(isolationRoot, 'user-data')
  const appDataDir = join(isolationRoot, 'app-data')
  mkdirSync(userDataDir, { recursive: true })
  mkdirSync(appDataDir, { recursive: true })

  const collectedLines: string[] = []

  // Gate --no-sandbox behind VARLENS_E2E_NO_SANDBOX=1. Default is the full
  // Chromium sandbox (matches how real users launch) so the smoke catches
  // sandbox-related regressions. Set the env var only on environments where
  // the sandbox cannot initialize (e.g. containers without user-namespace
  // support).
  const launchArgs = process.env.VARLENS_E2E_NO_SANDBOX === '1' ? ['--no-sandbox'] : []
  const child = spawn(executablePath, launchArgs, {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOME: isolationRoot,
      XDG_CONFIG_HOME: appDataDir,
      XDG_DATA_HOME: appDataDir,
      VARLENS_APP_DATA_DIR: appDataDir,
      VARLENS_USER_DATA_DIR: userDataDir,
      VARLENS_PERF_MODE: '1',
      // Suppress GPU errors on headless CI
      DISPLAY: process.env.DISPLAY ?? ':99'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })

  // Keep collecting lines for the entire child lifetime so post-ready crash
  // patterns are visible to callers.
  function bufferLines(data: Buffer): void {
    for (const line of data.toString('utf8').split('\n')) {
      if (line.trim() !== '') {
        collectedLines.push(line)
      }
    }
  }

  child.stdout?.on('data', bufferLines)
  child.stderr?.on('data', bufferLines)

  async function bestEffortCleanup(): Promise<void> {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
    }
    try {
      rmSync(isolationRoot, { recursive: true, force: true })
    } catch {
      // best-effort cleanup; ignore failures on long-lived CI mounts
    }
  }

  try {
    await new Promise<void>((resolveReady, rejectReady) => {
    const timer = setTimeout(() => {
      detach()
      rejectReady(
        new Error(
          `Packaged binary did not emit ready pattern ${String(readyPattern)} within ${timeoutMs}ms.\n` +
            `Output so far:\n${collectedLines.join('\n')}`
        )
      )
    }, timeoutMs)

    function detach(): void {
      child.stdout?.off('data', readyWatcher)
      child.stderr?.off('data', readyWatcher)
      child.off('error', onError)
      child.off('exit', onExit)
    }

    function readyWatcher(data: Buffer): void {
      for (const line of data.toString('utf8').split('\n')) {
        if (readyPattern.test(line)) {
          clearTimeout(timer)
          detach()
          resolveReady()
          return
        }
      }
    }

    function onError(err: Error): void {
      clearTimeout(timer)
      detach()
      rejectReady(new Error(`Failed to spawn packaged binary: ${err.message}`))
    }

    function onExit(code: number | null, signal: NodeJS.Signals | null): void {
      clearTimeout(timer)
      detach()
      rejectReady(
        new Error(
          `Packaged binary exited before emitting ready pattern (code=${String(code)}, signal=${String(signal)}).\n` +
            `Output:\n${collectedLines.join('\n')}`
        )
      )
    }

      child.stdout?.on('data', readyWatcher)
      child.stderr?.on('data', readyWatcher)
      child.on('error', onError)
      child.on('exit', onExit)
    })
  } catch (err) {
    // The child is spawned and temp dirs exist before the ready-wait begins,
    // so a rejection here would otherwise leak both. Clean up then rethrow
    // so callers see the original failure reason.
    await bestEffortCleanup()
    throw err
  }

  return {
    isolationRoot,
    userDataDir,
    appDataDir,
    executablePath,
    collectedLines,
    cleanup: async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM')
        await new Promise<void>((done) => {
          const t = setTimeout(() => {
            child.kill('SIGKILL')
            done()
          }, 3000)
          child.on('exit', () => {
            clearTimeout(t)
            done()
          })
        })
      }
      try {
        rmSync(isolationRoot, { recursive: true, force: true })
      } catch {
        // best-effort cleanup; ignore failures on long-lived CI mounts
      }
    }
  }
}
