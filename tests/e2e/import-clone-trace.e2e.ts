/**
 * E2E test: Reproduce DataCloneError via the ImportWizard UI flow.
 *
 * Run with: npx playwright test tests/e2e/import-clone-trace.e2e.ts
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
test('Trace DataCloneError through UI wizard flow', async ({}, testInfo) => {
  const files = [
    resolve(FIXTURE_DIR, 'simple-format.json'),
    resolve(FIXTURE_DIR, 'object-format.json')
  ]

  // Capture ALL console messages and errors
  const messages: string[] = []
  window.on('console', (msg) => {
    messages.push(`[console.${msg.type()}] ${msg.text()}`)
  })
  window.on('pageerror', (err) => {
    messages.push(`[pageerror] ${err.message}\n${err.stack}`)
  })

  // Mock dialog
  await app.evaluate(async ({ dialog }, filePaths) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths
    })
  }, files)

  // Open wizard
  const appBarBtns = window.locator('.v-app-bar .v-btn')
  await appBarBtns.last().click()
  await window.waitForTimeout(300)
  await window.locator('.v-list-item-title:text-is("Import Data")').click()
  await window.waitForTimeout(500)

  // Click Multiple Files
  await window.locator('.import-source-card:has-text("Multiple Files")').click()
  await window.waitForTimeout(1000)

  // Set overwrite if duplicates
  const overwriteRadio = window.locator('text=Overwrite duplicates')
  if ((await overwriteRadio.count()) > 0) {
    await overwriteRadio.click()
    await window.waitForTimeout(200)
  }

  // Click Import button
  const importBtn = window.locator('button:has-text("Import")')
  await expect(importBtn).toBeEnabled()
  await importBtn.click()

  // Wait for Done button
  const doneBtn = window.locator('button:has-text("Done")')
  await expect(doneBtn).toBeVisible({ timeout: 30000 })

  await window.waitForTimeout(500)
  await window.screenshot({ path: testInfo.outputPath('summary.png') })

  // Check for error alert
  const errorAlert = window.locator('.v-alert[type="error"]')
  const hasError = await errorAlert.isVisible()
  if (hasError) {
    const errorText = await errorAlert.textContent()
    console.log(`ERROR ALERT VISIBLE: "${errorText?.trim()}"`)
  } else {
    console.log('NO error alert visible - DataCloneError is FIXED!')
  }

  // Check import store state via evaluate
  const storeState = await window.evaluate(() => {
    // Access Pinia store
    const stores = document.querySelector('#app')?.__vue_app__?.config?.globalProperties?.$pinia
    if (!stores) return { error: 'Could not access Pinia' }
    const state = stores.state.value?.importStatus
    if (!state) return { error: 'importStatus store not found' }
    return {
      phase: state.phase,
      errorMessage: state.errorMessage,
      totalFiles: state.totalFiles,
      overallPercent: state.overallPercent
    }
  })
  console.log('Import store state:', JSON.stringify(storeState))

  // Print captured messages
  const relevantMessages = messages.filter(
    (m) =>
      m.includes('clone') ||
      m.includes('error') ||
      m.includes('Error') ||
      m.includes('import') ||
      m.includes('Import')
  )
  if (relevantMessages.length > 0) {
    console.log('\nRelevant console messages:')
    for (const msg of relevantMessages) {
      console.log(`  ${msg}`)
    }
  }

  // The test assertion: error should NOT be visible
  expect(hasError).toBe(false)

  // Close and cleanup
  await doneBtn.click()
  await window.waitForTimeout(300)

  await window.evaluate(async () => {
    const api = (
      window as unknown as {
        api: {
          cases: {
            list: () => Promise<Array<{ id: number; name: string }>>
            delete: (id: number) => Promise<void>
          }
        }
      }
    ).api
    const cases = await api.cases.list()
    for (const c of cases) {
      if (['simple-format', 'object-format'].includes(c.name)) {
        await api.cases.delete(c.id)
      }
    }
  })
})
