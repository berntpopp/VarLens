import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

export interface LaunchPackagedAppResult {
  app: ElectronApplication
  window: Page
  isolationRoot: string
  userDataDir: string
  appDataDir: string
  executablePath: string
  consoleMessages: string[]
  cleanup: () => Promise<void>
}

export function resolveLinuxPackagedBinary(projectRoot: string = process.cwd()): string {
  const releaseDir = resolve(projectRoot, 'release')
  if (!existsSync(releaseDir)) {
    throw new Error(
      `release/ does not exist at ${releaseDir} — run 'make dist-linux' before the packaged smoke test.`
    )
  }
  const entries = readdirSync(releaseDir)
  const appImage = entries.find((f) => f.endsWith('.AppImage'))
  if (appImage === undefined) {
    throw new Error(
      `No .AppImage found under ${releaseDir}. Entries: ${entries.join(', ') || '(empty)'}`
    )
  }
  return join(releaseDir, appImage)
}

export async function launchPackagedLinuxApp(): Promise<LaunchPackagedAppResult> {
  const executablePath = resolveLinuxPackagedBinary()

  const isolationRoot = mkdtempSync(join(tmpdir(), 'varlens-packaged-'))
  const userDataDir = join(isolationRoot, 'user-data')
  const appDataDir = join(isolationRoot, 'app-data')
  mkdirSync(userDataDir, { recursive: true })
  mkdirSync(appDataDir, { recursive: true })

  const app = await electron.launch({
    executablePath,
    // --appimage-extract-and-run removes the FUSE dependency; required in CI
    // containers where FUSE is not mounted. Harmless on developer machines.
    args: ['--appimage-extract-and-run'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOME: isolationRoot,
      XDG_CONFIG_HOME: appDataDir,
      XDG_DATA_HOME: appDataDir,
      VARLENS_APP_DATA_DIR: appDataDir,
      VARLENS_USER_DATA_DIR: userDataDir,
      VARLENS_PERF_MODE: '1'
    }
  })

  const logFilePath = join(userDataDir, 'logs', 'main.log')
  let window: Page
  try {
    window = await app.firstWindow()
  } catch (error) {
    const mainLog = existsSync(logFilePath)
      ? readFileSync(logFilePath, 'utf8').trim()
      : 'Main log file was not created before Electron exited.'

    throw new Error(
      [
        'Electron app closed before the first window became available.',
        `Isolation root: ${isolationRoot}`,
        `Main log: ${logFilePath}`,
        mainLog
      ].join('\n\n'),
      { cause: error }
    )
  }

  const consoleMessages: string[] = []
  window.on('console', (message) => {
    consoleMessages.push(`[${message.type()}] ${message.text()}`)
  })
  window.on('pageerror', (error) => {
    consoleMessages.push(`[pageerror] ${error.message}`)
  })

  return {
    app,
    window,
    isolationRoot,
    userDataDir,
    appDataDir,
    executablePath,
    consoleMessages,
    cleanup: async () => {
      await app.close()
    }
  }
}
