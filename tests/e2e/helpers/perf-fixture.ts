import type { ElectronApplication, Page } from '@playwright/test'
import { join } from 'path'
import { resolveAppPath } from './electron-app'

export const PERF_CASE_NAMES = ['perf-case-a', 'perf-case-b', 'perf-case-c'] as const
export const PERF_FIXTURE_PATH = resolveAppPath('tests/fixtures/import/columnar-format.json.gz')

interface ImportedCase {
  caseId: number
  caseName: string
  variantCount: number
}

const E2E_DB_PASSPHRASE = 'varlens-e2e-perf-passphrase'

function assertIpcOk(label: string, result: unknown): void {
  const failed =
    typeof result === 'object' &&
    result !== null &&
    (('code' in result && 'message' in result) || ('success' in result && result.success === false))
  if (failed) {
    throw new Error(`${label} failed: ${JSON.stringify(result)}`)
  }
}

/**
 * Simulate the user's file-dialog picks. Import and database paths are only
 * accepted after they were enrolled through a main-process dialog this
 * session (src/main/security/import-path-allowlist.ts), so the harness stubs
 * the dialog and goes through the same `select*` IPC a user would.
 */
async function stubDialogs(app: ElectronApplication, openPath: string, savePath: string): Promise<void> {
  await app.evaluate(
    ({ dialog }, paths) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [paths.openPath]
      })) as unknown as typeof dialog.showOpenDialog
      dialog.showSaveDialog = (async () => ({
        canceled: false,
        filePath: paths.savePath
      })) as unknown as typeof dialog.showSaveDialog
    },
    { openPath, savePath }
  )
}

/** Fresh isolated userData has no database: create one like first-run users do. */
export async function createPerfDatabase(
  app: ElectronApplication,
  window: Page,
  userDataDir: string
): Promise<void> {
  const dbPath = join(userDataDir, 'perf-e2e.db')
  await stubDialogs(app, PERF_FIXTURE_PATH, dbPath)
  const result = await window.evaluate(
    async (args: { path: string; passphrase: string }) => {
      const { path, passphrase } = args
      const picked = await window.api.database.selectSaveLocation('perf-e2e.db')
      if (picked === null) return { code: 'E2E', message: 'save dialog stub returned null' }
      const created = await window.api.database.create(path)
      const needsSetup =
        typeof created === 'object' && created !== null && 'needsPassphraseSetup' in created &&
        created.needsPassphraseSetup === true
      // No OS keyring (xvfb/CI): complete first-run setup with a passphrase.
      return needsSetup ? await window.api.database.create(path, undefined, passphrase) : created
    },
    { path: dbPath, passphrase: E2E_DB_PASSPHRASE }
  )
  assertIpcOk('database:create', result)
}

export async function importFrozenPerfFixture(
  window: Page,
  app?: ElectronApplication
): Promise<ImportedCase[]> {
  if (app !== undefined) {
    await stubDialogs(app, PERF_FIXTURE_PATH, PERF_FIXTURE_PATH)
    assertIpcOk('import:selectFile', await window.evaluate(async () => await window.api.import.selectFile()))
  }
  const importedCases: ImportedCase[] = []

  for (const caseName of PERF_CASE_NAMES) {
    const importedCase = await window.evaluate(
      async ([filePath, nextCaseName]) => {
        const result = await window.api.import.start(filePath, nextCaseName)
        if ('code' in result) throw new Error(`import:start failed: ${JSON.stringify(result)}`)
        return {
          caseId: result.caseId,
          caseName: nextCaseName,
          variantCount: result.variantCount
        }
      },
      [PERF_FIXTURE_PATH, caseName] as const
    )

    importedCases.push(importedCase)
  }

  return importedCases
}

export async function ensureSidebarVisible(window: Page): Promise<void> {
  const openSidebarButton = window.getByLabel('Open sidebar')
  if (await openSidebarButton.isVisible()) {
    await openSidebarButton.click()
    await window.waitForTimeout(300)
  }
}

export async function selectCaseByName(window: Page, caseName: string): Promise<void> {
  await ensureSidebarVisible(window)
  const caseItem = window
    .locator('.v-navigation-drawer .v-list-item')
    .filter({ hasText: caseName })
    .first()
  await caseItem.scrollIntoViewIfNeeded()
  await caseItem.click()

  const scrim = window.locator('.v-navigation-drawer__scrim')
  if ((await scrim.count()) > 0 && (await scrim.first().isVisible())) {
    await window.keyboard.press('Escape')
    await window.waitForTimeout(200)
  }
}
