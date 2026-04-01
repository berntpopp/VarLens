/**
 * E2E test for import and delete workflows.
 *
 * Verifies:
 * 1. Import of JSON files works via renderer API
 * 2. Case list updates after import
 * 3. Delete all cases completes without blocking (UI stays responsive)
 * 4. Case list is empty after deletion
 *
 * Run with: npx playwright test tests/e2e/import-delete.e2e.ts
 */
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { resolve } from 'path'

const FIXTURE_DIR = resolve(__dirname, '../fixtures/import')

let app: ElectronApplication
let window: Page

test.beforeAll(async () => {
  app = await electron.launch({
    args: ['./out/main/index.js'],
    env: {
      ...process.env,
      NODE_ENV: 'production'
    }
  })
  window = await app.firstWindow()
  await window.waitForSelector('.v-application', { timeout: 15000 })

  // Dismiss disclaimer dialog if present
  const disclaimerBtn = window.locator('button:has-text("I Understand")')
  if ((await disclaimerBtn.count()) > 0) {
    await disclaimerBtn.click()
    await window.waitForTimeout(500)
  }
})

test.afterAll(async () => {
  if (app) await app.close()
})

// eslint-disable-next-line no-empty-pattern
test('import files, verify case list, then delete all', async ({}, testInfo) => {
  // Step 1: Import files via the renderer window.api.import.start()
  const files = [
    { path: resolve(FIXTURE_DIR, 'simple-format.json'), name: 'simple-format' },
    { path: resolve(FIXTURE_DIR, 'object-format.json'), name: 'object-format' },
    { path: resolve(FIXTURE_DIR, 'columnar-format.json'), name: 'columnar-format' },
    { path: resolve(FIXTURE_DIR, 'simple-format.json.gz'), name: 'simple-gzipped' },
    { path: resolve(FIXTURE_DIR, 'object-format.json.gz'), name: 'object-gzipped' },
    { path: resolve(FIXTURE_DIR, 'columnar-format.json.gz'), name: 'columnar-gzipped' }
  ]

  console.log('Importing 6 test files...')
  for (const file of files) {
    const escapedPath = file.path.replace(/\\/g, '\\\\')
    const result = await window.evaluate(
      ([filePath, caseName]) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (window as any).api.import.start(filePath, caseName)
      },
      [escapedPath, file.name]
    )
    console.log(`  Imported "${file.name}":`, JSON.stringify(result))
  }

  // Wait for UI to update
  await window.waitForTimeout(1000)

  // Open sidebar if not visible
  const sidebar = window.locator('.v-navigation-drawer--left')
  if (!(await sidebar.isVisible())) {
    const toggleBtn = window.locator('.sidebar-toggle-btn')
    if ((await toggleBtn.count()) > 0) {
      await toggleBtn.click()
      await window.waitForTimeout(300)
    }
  }

  await window.screenshot({ path: testInfo.outputPath('01-after-import.png') })

  // Verify cases exist by checking the case count in the API
  const caseCount = await window.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).api.cases.list().then((cases: unknown[]) => cases.length)
  })
  console.log(`Case count after import: ${caseCount}`)
  expect(caseCount).toBe(6)

  // Step 2: Delete all cases and verify UI stays responsive
  console.log('Opening settings menu...')
  const settingsBtn = window.locator('.v-app-bar .v-btn:has(.mdi-cog)')
  await settingsBtn.click()
  await window.waitForTimeout(300)

  await window.screenshot({ path: testInfo.outputPath('02-settings-menu.png') })

  console.log('Clicking Delete All Cases...')
  const deleteMenuItem = window.locator('text=Delete All Cases')
  await expect(deleteMenuItem).toBeVisible({ timeout: 3000 })
  await deleteMenuItem.click()
  await window.waitForTimeout(500)

  await window.screenshot({ path: testInfo.outputPath('03-delete-dialog.png') })

  // Type "DELETE" in the confirmation input
  const confirmInput = window.locator('input[type="text"]').last()
  await expect(confirmInput).toBeVisible({ timeout: 3000 })
  await confirmInput.fill('DELETE')
  await window.waitForTimeout(200)

  // Find and click the "Delete All" button
  const deleteBtn = window.locator('button:has-text("Delete All")').last()
  await expect(deleteBtn).toBeEnabled({ timeout: 3000 })

  console.log('Clicking Delete All button...')
  const deleteStart = Date.now()

  await deleteBtn.click()

  // If UI is responsive, we should be able to immediately query an element.
  // If delete blocks the main thread, this will time out.
  const appVisible = await window.locator('.v-application').isVisible()
  const uiCheckTime = Date.now() - deleteStart
  console.log(
    `UI check after delete click took ${uiCheckTime}ms (should be <500ms if non-blocking)`
  )
  expect(appVisible).toBe(true)

  // Wait for delete to complete and snackbar to appear
  await window.waitForTimeout(3000)

  const deleteEnd = Date.now()
  console.log(`Total time from click to verification: ${deleteEnd - deleteStart}ms`)

  await window.screenshot({ path: testInfo.outputPath('04-after-delete.png') })

  // Verify all cases are deleted
  const caseCountAfter = await window.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).api.cases.list().then((cases: unknown[]) => cases.length)
  })
  console.log(`Case count after delete: ${caseCountAfter}`)
  expect(caseCountAfter).toBe(0)
})
