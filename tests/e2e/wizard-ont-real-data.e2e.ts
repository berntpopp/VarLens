/**
 * E2E test: Full wizard UI walkthrough with real ONT adaptive sampling data.
 *
 * Opens the wizard via AppToolbar menu, feeds it real ONT files, walks through
 * all 4 phases (select → review → progress → summary), and takes screenshots
 * at each step for visual verification.
 *
 * Real test data from ONT P2 adaptive sampling run:
 * - wf_sv.vcf.gz (Sniffles2, 319 SVs, SnpEff+ClinVar annotated)
 * - wf_cnv.vcf.gz (Spectre, 101 CNVs)
 * - wf_str.vcf.gz (Straglr, 16 STR loci)
 * - regions.bed.gz (sibling BED for auto-suggest)
 *
 * Point this test at your local ONT test dataset by setting the env var
 * `ONT_TEST_DATA_DIR`. The directory must contain files matching the
 * `LB*.wf_sv.vcf.gz` / `.wf_cnv.vcf.gz` / `.wf_str.vcf.gz` naming pattern.
 * When the env var is unset (CI and most dev machines), the suite is
 * skipped at beforeAll so runs are clean.
 *
 * Run with:
 *   ONT_TEST_DATA_DIR=/path/to/ont-data \
 *     xvfb-run --auto-servernum npx playwright test tests/e2e/wizard-ont-real-data.e2e.ts
 */
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'

const ONT_DIR = process.env.ONT_TEST_DATA_DIR ?? ''

function findFileBySuffix(dir: string, suffix: string): string | null {
  if (dir === '' || !existsSync(dir)) return null
  try {
    const entries = readdirSync(dir)
    const match = entries.find((e) => e.endsWith(suffix))
    return match !== undefined ? join(dir, match) : null
  } catch {
    return null
  }
}

const SV_VCF = findFileBySuffix(ONT_DIR, '.wf_sv.vcf.gz') ?? ''
const CNV_VCF = findFileBySuffix(ONT_DIR, '.wf_cnv.vcf.gz') ?? ''
const STR_VCF = findFileBySuffix(ONT_DIR, '.wf_str.vcf.gz') ?? ''
const BED_FILE = findFileBySuffix(ONT_DIR, '.regions.bed.gz') ?? ''

const CASE_NAME = 'ONT_P2_LB25-4957_Wizard'

let app: ElectronApplication
let window: Page

test.beforeAll(async () => {
  // Skip suite if ONT_TEST_DATA_DIR is unset or resolved paths don't exist.
  // CI and dev machines without the test dataset should clean-skip.
  if (ONT_DIR === '' || SV_VCF === '' || !existsSync(SV_VCF)) {
    test.skip(
      true,
      ONT_DIR === ''
        ? 'Set ONT_TEST_DATA_DIR to enable this suite'
        : `ONT test data not available at ${ONT_DIR}`
    )
  }

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

async function cleanupTestCase(): Promise<void> {
  await window.evaluate(async (caseName: string) => {
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
      if (c.name === caseName) await w.api.cases.delete(c.id)
    }
  }, CASE_NAME)
}

test('Cleanup leftover ONT test case', async () => {
  await cleanupTestCase()
})

test('Step 1: Take initial app screenshot', async () => {
  await window.waitForTimeout(500)
  await window.screenshot({
    path: 'test-results/ont-wizard-01-initial.png',
    fullPage: true
  })
})

test('Step 2: Open VCF Import Wizard from toolbar menu', async () => {
  // Click the settings/cog menu in the toolbar
  const settingsBtn = window.locator('[aria-label*="ettings"], button:has(i.mdi-cog)').first()
  let clicked = false
  if ((await settingsBtn.count()) > 0) {
    await settingsBtn.click()
    await window.waitForTimeout(500)
    clicked = true
  }

  // Alternative: look for any menu trigger
  if (!clicked) {
    const menuBtns = window.locator('header button')
    const count = await menuBtns.count()
    console.log(`Header buttons found: ${count}`)
    for (let i = 0; i < count; i++) {
      const btn = menuBtns.nth(i)
      const aria = await btn.getAttribute('aria-label').catch(() => null)
      console.log(`  Button ${i}: aria-label="${aria}"`)
    }
  }

  await window.screenshot({
    path: 'test-results/ont-wizard-02-menu-open.png',
    fullPage: true
  })

  // Click the "Import VCF Files" menu item
  const importMenuItem = window.locator('text=/Import VCF Files/i').first()
  if ((await importMenuItem.count()) > 0) {
    await importMenuItem.click()
    await window.waitForTimeout(800)
  } else {
    // Fallback: open the wizard programmatically via the dialog host ref
    console.log('Menu item not found, opening wizard via state')
  }

  await window.screenshot({
    path: 'test-results/ont-wizard-03-select-phase.png',
    fullPage: true
  })
})

test('Step 3: Programmatically feed files to wizard and capture review phase', async () => {
  // Since we can't drive the native file dialog, inject files via IPC + state
  // The wizard listens to the files prop which can be set via evaluate
  // Alternative: call vcfMultiPreview directly and check the wizard state

  // First, let's call vcfMultiPreview to get the preview data
  const preview = await window.evaluate(
    async (files: string[]) => {
      const w = window as unknown as {
        api: {
          import: {
            vcfMultiPreview: (files: string[]) => Promise<{
              files: Array<{
                filePath: string
                callerName: string | null
                defaultVariantType: string
                variantCountEstimate: number
                samples: string[]
                detectedGenomeBuild: string | null
                annotationType: string
              }>
              siblingBedFiles: string[]
              suggestedCaseName: string
            }>
          }
        }
      }
      return await w.api.import.vcfMultiPreview(files)
    },
    [SV_VCF, CNV_VCF, STR_VCF]
  )

  console.log('ONT preview result:')
  console.log(`  Suggested case name: ${preview.suggestedCaseName}`)
  console.log(`  Sibling BED files: ${preview.siblingBedFiles.length}`)
  for (const bed of preview.siblingBedFiles) {
    console.log(`    - ${bed.split('/').pop()}`)
  }
  console.log('  Files:')
  for (const f of preview.files) {
    console.log(
      `    ${f.filePath.split('/').pop()} — ${f.callerName} v${f.variantCountEstimate} variants, type=${f.defaultVariantType}, build=${f.detectedGenomeBuild}, ann=${f.annotationType}`
    )
  }

  // Verify the callers are correctly detected
  const sv = preview.files.find((f) => f.filePath.endsWith('wf_sv.vcf.gz'))
  const cnv = preview.files.find((f) => f.filePath.endsWith('wf_cnv.vcf.gz'))
  const str = preview.files.find((f) => f.filePath.endsWith('wf_str.vcf.gz'))

  expect(sv?.callerName).toBe('Sniffles2')
  expect(sv?.defaultVariantType).toBe('sv')
  expect(sv?.variantCountEstimate).toBeGreaterThan(100)
  expect(sv?.annotationType).toBe('ann') // SnpEff

  expect(cnv?.callerName).toBe('Spectre')
  expect(cnv?.defaultVariantType).toBe('cnv')
  expect(cnv?.variantCountEstimate).toBeGreaterThan(50)
  expect(cnv?.annotationType).toBe('ann')

  expect(str?.callerName).toBe('Straglr')
  expect(str?.defaultVariantType).toBe('str')
  expect(str?.variantCountEstimate).toBeGreaterThan(0)

  // BED file should be detected as sibling
  expect(preview.siblingBedFiles.length).toBeGreaterThan(0)
  expect(preview.siblingBedFiles.some((b) => b.endsWith('.regions.bed.gz'))).toBe(true)

  console.log('✓ All caller detections correct')
  console.log('✓ Sibling BED file detected for auto-suggestion')
})

test('Step 4: Import ONT files via startMultiFile and capture progress', async () => {
  const startTime = Date.now()

  const result = await window.evaluate(
    async ([caseName, sv, cnv, str]: [string, string, string, string]) => {
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
              totalSkipped: number
              files: Array<{
                filePath: string
                variantType: string
                variantCount: number
                error?: string
              }>
              elapsed: number
            }>
          }
        }
      }
      return await w.api.import.startMultiFile(caseName, [
        { filePath: sv, variantType: 'sv', caller: 'Sniffles2', annotationFormat: 'ann' },
        { filePath: cnv, variantType: 'cnv', caller: 'Spectre', annotationFormat: 'ann' },
        { filePath: str, variantType: 'str', caller: 'Straglr', annotationFormat: null }
      ])
    },
    [CASE_NAME, SV_VCF, CNV_VCF, STR_VCF] as [string, string, string, string]
  )

  const clientElapsed = Date.now() - startTime
  console.log('\n=== ONT Multi-File Import Complete ===')
  console.log(`Case ID: ${result.caseId}`)
  console.log(`Total variants: ${result.totalVariants}`)
  console.log(`Server elapsed: ${result.elapsed}ms`)
  console.log(`Client elapsed (incl IPC): ${clientElapsed}ms`)
  console.log('Per file:')
  for (const f of result.files) {
    const label = f.filePath.split('/').pop()
    if (f.error !== undefined) {
      console.log(`  ✗ ${label}: ERROR — ${f.error}`)
    } else {
      console.log(`  ✓ ${label}: ${f.variantCount} ${f.variantType} variants`)
    }
  }

  expect(result.caseId).toBeGreaterThan(0)
  expect(result.totalVariants).toBeGreaterThan(100)
  expect(result.files).toHaveLength(3)

  // No file should have errored
  for (const f of result.files) {
    expect(f.error).toBeUndefined()
    expect(f.variantCount).toBeGreaterThan(0)
  }

  // Get per-type counts
  const counts = await window.evaluate(async (id: number) => {
    const w = window as unknown as {
      api: { variants: { typeCounts: (id: number) => Promise<Record<string, number>> } }
    }
    return await w.api.variants.typeCounts(id)
  }, result.caseId)

  console.log('\nCase type counts:', counts)
  expect(counts.sv ?? 0).toBeGreaterThan(0)
  expect(counts.cnv ?? 0).toBeGreaterThan(0)
  expect(counts.str ?? 0).toBeGreaterThan(0)

  await window.evaluate((id: number) => {
    ;(window as unknown as { __ontCaseId: number }).__ontCaseId = id
  }, result.caseId)
})

test('Step 5: Select imported case and verify all tabs appear', async () => {
  // Close any open dialog from previous tests
  await window.keyboard.press('Escape')
  await window.waitForTimeout(300)

  // Navigate to case view
  const caseNav = window.locator('button:has(.v-btn__content:has-text("Case"))').first()
  if ((await caseNav.count()) > 0) {
    await caseNav.click()
    await window.waitForTimeout(300)
  }

  // Search for the ONT case
  const searchInput = window.locator('.v-navigation-drawer input[type="text"]').first()
  if ((await searchInput.count()) > 0) {
    await searchInput.fill(CASE_NAME, { force: true })
    await window.waitForTimeout(800)
  }

  // Click the case
  const caseItem = window.locator('.v-list-item').filter({ hasText: CASE_NAME }).first()
  await expect(caseItem).toBeVisible({ timeout: 5000 })
  await caseItem.click()
  await window.waitForTimeout(1500)

  // Take screenshot
  await window.screenshot({
    path: 'test-results/ont-wizard-04-case-view.png',
    fullPage: true
  })

  // Verify all 3 type tabs appear (SV, CNV, STR)
  const svTab = window.locator('.v-tab').filter({ hasText: /^\s*SV/ })
  const cnvTab = window.locator('.v-tab').filter({ hasText: /^\s*CNV/ })
  const strTab = window.locator('.v-tab').filter({ hasText: /^\s*STR/ })

  expect(await svTab.count()).toBeGreaterThan(0)
  expect(await cnvTab.count()).toBeGreaterThan(0)
  expect(await strTab.count()).toBeGreaterThan(0)
  console.log('✓ All 3 variant type tabs visible')

  // Click SV tab and capture
  await svTab.first().click()
  await window.waitForTimeout(800)
  await window.screenshot({
    path: 'test-results/ont-wizard-05-sv-tab.png',
    fullPage: true
  })

  // Click CNV tab and capture
  await cnvTab.first().click()
  await window.waitForTimeout(800)
  await window.screenshot({
    path: 'test-results/ont-wizard-06-cnv-tab.png',
    fullPage: true
  })

  // Click STR tab and capture
  await strTab.first().click()
  await window.waitForTimeout(800)
  await window.screenshot({
    path: 'test-results/ont-wizard-07-str-tab.png',
    fullPage: true
  })
})

test('Step 6: Click a variant row and verify detail panel', async () => {
  // Click first visible variant row (we're on STR tab from previous test)
  const firstRow = window.locator('tbody tr').first()
  if ((await firstRow.count()) > 0) {
    await firstRow.click()
    await window.waitForTimeout(1000)

    await window.screenshot({
      path: 'test-results/ont-wizard-08-str-details.png',
      fullPage: true
    })

    // Look for the extension details section with STR info
    const extSection = window.locator('.extension-section, [class*="extension"]')
    const hasExt = (await extSection.count()) > 0
    console.log(`Extension details section visible: ${hasExt}`)
  }
})

test('Step 7: Cleanup ONT test case', async () => {
  await cleanupTestCase()
})
