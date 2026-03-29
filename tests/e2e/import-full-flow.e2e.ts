/**
 * E2E test: full import flow using real data files.
 *
 * Tests the complete import pipeline end-to-end by injecting file paths
 * programmatically (bypassing native file dialogs) and driving the
 * ImportWizard UI through all steps.
 *
 * Run with: npx playwright test tests/e2e/import-full-flow.e2e.ts
 */
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { resolve } from 'path'
import { existsSync, readdirSync } from 'fs'

const FIXTURE_DIR = resolve(__dirname, '../fixtures/import')
const REAL_DATA_DIR = process.env.REAL_DATA_DIR ?? ''

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

test('Import fixture files via batch API and verify cases appear', async () => {
  const files = [
    resolve(FIXTURE_DIR, 'simple-format.json'),
    resolve(FIXTURE_DIR, 'object-format.json'),
    resolve(FIXTURE_DIR, 'columnar-format.json')
  ]

  // Import all 3 fixture files via batch API
  const result = await window.evaluate(async (filePaths: string[]) => {
    const api = (
      window as unknown as {
        api: {
          batchImport: {
            checkDuplicates: (paths: string[]) => Promise<{
              files: Array<{ caseName: string; isDuplicate: boolean }>
              duplicateCount: number
            }>
            start: (
              paths: string[],
              strategy: string
            ) => Promise<{
              succeeded: number
              failed: number
              skipped: number
              cancelled: boolean
              details: Array<{
                fileName: string
                caseName: string
                status: string
                variantCount?: number
                error?: string
              }>
            }>
          }
          cases: { list: () => Promise<Array<{ id: number; name: string }>> }
        }
      }
    ).api

    // Check duplicates first
    const check = await api.batchImport.checkDuplicates(filePaths)
    console.log('checkDuplicates:', JSON.stringify(check))

    // Start import (overwrite to handle re-runs)
    const importResult = await api.batchImport.start(filePaths, 'overwrite')
    console.log('import result:', JSON.stringify(importResult))

    // Get case list
    const cases = await api.cases.list()

    return {
      check,
      importResult,
      caseNames: cases.map((c: { name: string }) => c.name)
    }
  }, files)

  console.log('Import result:', JSON.stringify(result.importResult, null, 2))

  expect(result.importResult.succeeded).toBe(3)
  expect(result.importResult.failed).toBe(0)
  expect(result.caseNames).toContain('simple-format')
  expect(result.caseNames).toContain('object-format')
  expect(result.caseNames).toContain('columnar-format')
})

test('Import real immunology case files', async () => {
  if (!existsSync(REAL_DATA_DIR)) {
    test.skip()
    return
  }

  const jsonGzFiles = readdirSync(REAL_DATA_DIR)
    .filter((f) => f.endsWith('.json.gz'))
    .map((f) => resolve(REAL_DATA_DIR, f))

  if (jsonGzFiles.length === 0) {
    test.skip()
    return
  }

  console.log(`Found ${jsonGzFiles.length} .json.gz files in ${REAL_DATA_DIR}`)

  // Import all real files
  const result = await window.evaluate(async (filePaths: string[]) => {
    const api = (
      window as unknown as {
        api: {
          batchImport: {
            checkDuplicates: (paths: string[]) => Promise<{
              files: Array<{ caseName: string; isDuplicate: boolean }>
              duplicateCount: number
            }>
            start: (
              paths: string[],
              strategy: string
            ) => Promise<{
              succeeded: number
              failed: number
              skipped: number
              cancelled: boolean
              details: Array<{
                fileName: string
                caseName: string
                status: string
                variantCount?: number
                error?: string
              }>
            }>
          }
        }
      }
    ).api

    const check = await api.batchImport.checkDuplicates(filePaths)
    const importResult = await api.batchImport.start(filePaths, 'overwrite')
    return { check, importResult }
  }, jsonGzFiles)

  console.log(
    `Imported: ${result.importResult.succeeded} succeeded, ${result.importResult.failed} failed, ${result.importResult.skipped} skipped`
  )

  for (const detail of result.importResult.details) {
    const status =
      detail.status === 'success' ? `✓ ${detail.variantCount} variants` : `✗ ${detail.error}`
    console.log(`  ${detail.caseName}: ${status}`)
  }

  expect(result.importResult.succeeded).toBe(jsonGzFiles.length)
  expect(result.importResult.failed).toBe(0)
})

test('Verify imported cases are accessible', async () => {
  const cases = await window.evaluate(async () => {
    const api = (
      window as unknown as {
        api: {
          cases: {
            list: () => Promise<Array<{ id: number; name: string; variant_count: number }>>
          }
        }
      }
    ).api
    return api.cases.list()
  })

  console.log(`Total cases in database: ${cases.length}`)

  // At minimum, our 3 fixture files should be there
  const fixtureNames = ['simple-format', 'object-format', 'columnar-format']
  for (const name of fixtureNames) {
    const found = cases.find((c: { name: string }) => c.name === name)
    expect(found).toBeDefined()
    console.log(`  ${name}: ${found?.variant_count ?? '?'} variants`)
  }
})

test('Cleanup fixture test cases', async () => {
  const testNames = ['simple-format', 'object-format', 'columnar-format']

  for (const name of testNames) {
    await window.evaluate(async (caseName: string) => {
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
      const target = cases.find((c: { name: string }) => c.name === caseName)
      if (target) await api.cases.delete(target.id)
    }, name)
  }

  console.log('Cleaned up fixture test cases')
})
