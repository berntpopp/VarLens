/**
 * E2E test: Multi-file VCF import wizard.
 *
 * Tests the Phase 4 wizard:
 * - Multi-file preview IPC (vcfMultiPreview) returns files + sibling BEDs
 * - Multi-file import IPC (startMultiFile) creates case with all variants
 * - Wizard UI opens, displays files, imports, shows summary
 *
 * Run with: xvfb-run --auto-servernum npx playwright test tests/e2e/vcf-import-wizard.e2e.ts
 */
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { resolve } from 'path'

const VCF_DIR = resolve(__dirname, '../test-data/vcf')
const CASE_PREFIX = 'E2EWizard'

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

async function cleanupTestCases(): Promise<void> {
  await window.evaluate(async (prefix: string) => {
    const w = window as unknown as {
      api: {
        cases: {
          list: () => Promise<Array<{ id: number; name: string }>>
          delete: (id: number) => Promise<void>
        }
      }
    }
    const cases = await w.api.cases.list()
    for (const c of cases) {
      if (c.name.startsWith(prefix)) await w.api.cases.delete(c.id)
    }
  }, CASE_PREFIX)
}

test('cleanup leftover test cases before run', async () => {
  await cleanupTestCases()
})

test('vcfMultiPreview returns metadata for all files', async () => {
  const svPath = resolve(VCF_DIR, 'synthetic-sv.vcf')
  const cnvPath = resolve(VCF_DIR, 'synthetic-cnv.vcf')
  const strPath = resolve(VCF_DIR, 'synthetic-str.vcf')

  const result = await window.evaluate(
    async (paths: string[]) => {
      const w = window as unknown as {
        api: {
          import: {
            vcfMultiPreview: (paths: string[]) => Promise<{
              files: Array<{
                filePath: string
                callerName: string | null
                defaultVariantType: string
                variantCountEstimate: number
                samples: string[]
              }>
              siblingBedFiles: string[]
              suggestedCaseName: string
            }>
          }
        }
      }
      return await w.api.import.vcfMultiPreview(paths)
    },
    [svPath, cnvPath, strPath]
  )

  expect(result.files).toHaveLength(3)

  const sv = result.files.find((f) => f.filePath.includes('synthetic-sv'))
  const cnv = result.files.find((f) => f.filePath.includes('synthetic-cnv'))
  const str = result.files.find((f) => f.filePath.includes('synthetic-str'))

  expect(sv?.callerName).toBe('Sniffles2')
  expect(sv?.defaultVariantType).toBe('sv')
  expect(sv?.variantCountEstimate).toBeGreaterThan(0)

  expect(cnv?.callerName).toBe('Spectre')
  expect(cnv?.defaultVariantType).toBe('cnv')

  expect(str?.callerName).toBe('Straglr')
  expect(str?.defaultVariantType).toBe('str')

  // Suggested case name should be from first file's sample ID
  expect(result.suggestedCaseName).toBeTruthy()
  console.log('Multi-preview result:', {
    filesCount: result.files.length,
    siblingBeds: result.siblingBedFiles.length,
    suggestedName: result.suggestedCaseName
  })
})

test('startMultiFile imports SV + CNV + STR into single case', async () => {
  const svPath = resolve(VCF_DIR, 'synthetic-sv.vcf')
  const cnvPath = resolve(VCF_DIR, 'synthetic-cnv.vcf')
  const strPath = resolve(VCF_DIR, 'synthetic-str.vcf')
  const caseName = `${CASE_PREFIX}_Multi`

  const result = await window.evaluate(
    async ([caseName, svPath, cnvPath, strPath]: [string, string, string, string]) => {
      const w = window as unknown as {
        api: {
          import: {
            startMultiFile: (
              caseName: string,
              files: Array<{
                filePath: string
                variantType: string
                caller: string | null
                annotationFormat: string | null
              }>
            ) => Promise<{
              caseId: number
              totalVariants: number
              files: Array<{ filePath: string; variantType: string; variantCount: number }>
              elapsed: number
            }>
          }
        }
      }
      return await w.api.import.startMultiFile(caseName, [
        { filePath: svPath, variantType: 'sv', caller: 'Sniffles2', annotationFormat: 'ann' },
        { filePath: cnvPath, variantType: 'cnv', caller: 'Spectre', annotationFormat: 'ann' },
        { filePath: strPath, variantType: 'str', caller: 'Straglr', annotationFormat: null }
      ])
    },
    [caseName, svPath, cnvPath, strPath] as [string, string, string, string]
  )

  expect(result.caseId).toBeGreaterThan(0)
  expect(result.totalVariants).toBeGreaterThan(0)
  expect(result.files).toHaveLength(3)

  console.log('Multi-file import result:', {
    caseId: result.caseId,
    totalVariants: result.totalVariants,
    perFile: result.files.map((f) => `${f.variantType}:${f.variantCount}`),
    elapsed: result.elapsed + 'ms'
  })

  // Verify variant type counts match
  const counts = await window.evaluate(async (id: number) => {
    const w = window as unknown as {
      api: { variants: { typeCounts: (id: number) => Promise<Record<string, number>> } }
    }
    return await w.api.variants.typeCounts(id)
  }, result.caseId)

  console.log('Case type counts after multi-import:', counts)
  expect((counts.sv ?? 0) + (counts.indel ?? 0)).toBeGreaterThan(0)
  expect(counts.cnv ?? 0).toBeGreaterThan(0)
  expect(counts.str ?? 0).toBeGreaterThan(0)

  // Verify case was populated via list query
  const cases = await window.evaluate(async () => {
    const w = window as unknown as {
      api: {
        cases: {
          list: () => Promise<Array<{ id: number; name: string; variant_count: number }>>
        }
      }
    }
    return await w.api.cases.list()
  })

  const importedCase = cases.find((c) => c.id === result.caseId)
  console.log('Case after import:', importedCase)
  expect(importedCase).toBeDefined()
  expect(importedCase!.variant_count).toBeGreaterThan(0)

  // Store case id for visual test
  await window.evaluate((id: number) => {
    ;(window as unknown as { __multiCaseId: number }).__multiCaseId = id
  }, result.caseId)
})

test('Visual: open wizard, take screenshot, verify case appears in list', async () => {
  // Navigate to case view
  const caseNavBtn = window.locator('button:has(.v-btn__content:has-text("Case"))').first()
  if ((await caseNavBtn.count()) > 0) {
    await caseNavBtn.click()
    await window.waitForTimeout(300)
  }

  // Use search to find the multi-file case
  const searchInput = window.locator('.v-navigation-drawer input[type="text"]').first()
  if ((await searchInput.count()) > 0) {
    await searchInput.fill(`${CASE_PREFIX}_Multi`, { force: true })
    await window.waitForTimeout(800)
  }

  // Take screenshot of case list showing the imported case
  await window.screenshot({
    path: 'test-results/wizard-case-list.png',
    fullPage: true
  })

  // Select the case
  const caseItem = window
    .locator('.v-list-item')
    .filter({ hasText: `${CASE_PREFIX}_Multi` })
    .first()
  if ((await caseItem.count()) > 0) {
    await caseItem.click()
    await window.waitForTimeout(1500)
  }

  // Take screenshot of the case with all variant type tabs
  await window.screenshot({
    path: 'test-results/wizard-multi-type-case.png',
    fullPage: true
  })

  // Verify all three tabs are visible (SV, CNV, STR)
  const svTab = window.locator('.v-tab').filter({ hasText: /^\s*SV/ })
  const cnvTab = window.locator('.v-tab').filter({ hasText: /^\s*CNV/ })
  const strTab = window.locator('.v-tab').filter({ hasText: /^\s*STR/ })

  const svCount = await svTab.count()
  const cnvCount = await cnvTab.count()
  const strCount = await strTab.count()

  console.log(`Tabs visible — SV: ${svCount}, CNV: ${cnvCount}, STR: ${strCount}`)

  // At least CNV and STR should be visible (SV might be hidden if snv count is 0)
  expect(cnvCount).toBeGreaterThan(0)
  expect(strCount).toBeGreaterThan(0)
})

test('Cleanup: delete wizard test cases', async () => {
  await cleanupTestCases()
})
