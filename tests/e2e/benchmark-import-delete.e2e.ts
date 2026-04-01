/**
 * Benchmark E2E test: Import 50 real files, measure performance, delete all, verify UI.
 *
 * Run with: npx playwright test tests/e2e/benchmark-import-delete.e2e.ts --timeout 600000
 */
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { readdirSync, existsSync } from 'fs'
import { resolve, basename } from 'path'

const BENCH_DIR = '/tmp/varlens-bench'
const files = existsSync(BENCH_DIR)
  ? readdirSync(BENCH_DIR)
      .filter((f) => f.endsWith('.json.gz') || f.endsWith('.json'))
      .map((f) => resolve(BENCH_DIR, f))
      .slice(0, 50)
  : []

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
test('benchmark: import 50 files, verify, delete all', async ({}, testInfo) => {
  test.skip(files.length === 0, `Benchmark directory ${BENCH_DIR} not found or empty`)
  test.setTimeout(600000)

  console.log(`\n=== IMPORT BENCHMARK: ${files.length} files ===\n`)

  const importTimes: { file: string; ms: number; variants: number }[] = []
  const totalStart = Date.now()

  // Import each file individually and measure time
  for (let i = 0; i < files.length; i++) {
    const filePath = files[i]
    const caseName = basename(filePath)
      .replace(/\.json\.gz$/, '')
      .replace(/\.json$/, '')
    const escapedPath = filePath.replace(/\\/g, '\\\\')

    const start = Date.now()
    const result = await window.evaluate(
      ([fp, cn]) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (window as any).api.import.start(fp, cn)
      },
      [escapedPath, caseName]
    )
    const elapsed = Date.now() - start

    const variantCount = (result as { variantCount?: number })?.variantCount ?? 0
    importTimes.push({ file: caseName, ms: elapsed, variants: variantCount })

    if ((i + 1) % 10 === 0 || i === files.length - 1) {
      console.log(
        `  [${i + 1}/${files.length}] "${caseName}": ${elapsed}ms (${variantCount} variants)`
      )
    }
  }

  const totalImportMs = Date.now() - totalStart

  // Print summary
  const totalVariants = importTimes.reduce((sum, t) => sum + t.variants, 0)
  const avgMs = Math.round(totalImportMs / files.length)
  const variantsPerSec = Math.round((totalVariants / totalImportMs) * 1000)

  console.log(`\n=== IMPORT SUMMARY ===`)
  console.log(`  Files imported: ${files.length}`)
  console.log(`  Total variants: ${totalVariants}`)
  console.log(`  Total time: ${totalImportMs}ms (${(totalImportMs / 1000).toFixed(1)}s)`)
  console.log(`  Average per file: ${avgMs}ms`)
  console.log(`  Throughput: ${variantsPerSec} variants/sec`)

  // Slowest 5 files
  const sorted = [...importTimes].sort((a, b) => b.ms - a.ms)
  console.log(`\n  Slowest files:`)
  for (const t of sorted.slice(0, 5)) {
    console.log(`    ${t.file}: ${t.ms}ms (${t.variants} variants)`)
  }

  // Verify all cases exist
  const caseCount = await window.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).api.cases.list().then((cases: unknown[]) => cases.length)
  })
  console.log(`\n  Cases in database: ${caseCount}`)
  expect(caseCount).toBe(files.length)

  await window.screenshot({ path: testInfo.outputPath('01-after-import.png') })

  // Step 2: Test delete all via UI
  console.log(`\n=== DELETE ALL CASES ===\n`)

  // Open settings menu
  const settingsBtn = window.locator('.v-app-bar .v-btn:has(.mdi-cog)')
  await settingsBtn.click()
  await window.waitForTimeout(300)

  // Click "Delete All Cases"
  const deleteMenuItem = window.locator('text=Delete All Cases')
  await expect(deleteMenuItem).toBeVisible({ timeout: 3000 })
  await deleteMenuItem.click()
  await window.waitForTimeout(500)

  // Type DELETE confirmation
  const confirmInput = window.locator('input[type="text"]').last()
  await expect(confirmInput).toBeVisible({ timeout: 3000 })
  await confirmInput.fill('DELETE')
  await window.waitForTimeout(200)

  // Click Delete All button
  const deleteBtn = window.locator('button:has-text("Delete All")').last()
  await expect(deleteBtn).toBeEnabled({ timeout: 3000 })

  const deleteStart = Date.now()
  console.log(`  Clicking Delete All (${caseCount} cases, ${totalVariants} variants)...`)

  await deleteBtn.click()

  // Check UI responsiveness immediately
  const appVisible = await window.locator('.v-application').isVisible()
  const uiCheckMs = Date.now() - deleteStart
  console.log(`  UI responsive check: ${uiCheckMs}ms after click`)
  expect(appVisible).toBe(true)

  // Wait for delete to complete - with 300K+ variants and cascading deletes,
  // this can take 30-60 seconds in the worker thread
  let caseCountAfter = caseCount
  for (let i = 0; i < 60; i++) {
    await window.waitForTimeout(2000)
    caseCountAfter = await window.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (window as any).api.cases.list().then((cases: unknown[]) => cases.length)
    })
    if (caseCountAfter === 0) break
    if (i % 5 === 0) {
      console.log(
        `  Waiting for delete... ${caseCountAfter} cases remaining (${(Date.now() - deleteStart) / 1000}s)`
      )
    }
  }

  const totalDeleteMs = Date.now() - deleteStart
  console.log(`  Total delete time: ${totalDeleteMs}ms`)
  console.log(`  Cases remaining: ${caseCountAfter}`)
  expect(caseCountAfter).toBe(0)

  await window.screenshot({ path: testInfo.outputPath('02-after-delete.png') })

  console.log(`\n=== BENCHMARK COMPLETE ===\n`)
})
