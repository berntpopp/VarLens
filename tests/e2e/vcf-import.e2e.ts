/**
 * E2E test: VCF file import.
 *
 * Tests importing VCF files (single-sample, VEP-annotated, SnpEff-annotated)
 * through the VCF import pipeline. Uses the IPC API directly since native
 * file dialogs cannot be driven by Playwright.
 *
 * Run with: npx playwright test tests/e2e/vcf-import.e2e.ts
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

test('VCF preview returns correct metadata for VEP-annotated VCF', async () => {
  const vcfPath = resolve(VCF_DIR, 'trio-region.vep.vcf.gz')

  const preview = await window.evaluate(async (filePath: string) => {
    return await (window as any).api.import.vcfPreview(filePath)
  }, vcfPath)

  expect(preview).toBeDefined()
  expect(preview.fileformat).toContain('VCFv4')
  expect(preview.samples.length).toBeGreaterThanOrEqual(1)
  expect(preview.annotationType).toBe('csq')
  expect(preview.variantCountEstimate).toBeGreaterThan(0)
})

test('Import single-sample VCF and verify case exists', async () => {
  const vcfPath = resolve(VCF_DIR, 'single-sample.vcf.gz')

  // Import via the import:start IPC (uses VcfStrategy automatically)
  const result = await window.evaluate(async (filePath: string) => {
    return await (window as any).api.import.start(filePath, 'e2e-single-sample-vcf')
  }, vcfPath)

  expect(result).toBeDefined()
  expect(result.variantCount).toBeGreaterThan(0)
  expect(result.errors).toHaveLength(0)

  // Verify case appears in case list
  const cases = await window.evaluate(async () => {
    return await (window as any).api.cases.list()
  })

  const importedCase = cases.find((c: { name: string }) => c.name === 'e2e-single-sample-vcf')
  expect(importedCase).toBeDefined()
  expect(importedCase.variant_count).toBeGreaterThan(0)
})

test('Import VEP-annotated VCF and verify CSQ annotations present', async () => {
  const vcfPath = resolve(VCF_DIR, 'trio-region.vep.vcf.gz')

  const result = await window.evaluate(async (filePath: string) => {
    return await (window as any).api.import.start(filePath, 'e2e-vep-annotated')
  }, vcfPath)

  expect(result.variantCount).toBeGreaterThan(100)
  expect(result.errors).toHaveLength(0)

  // Verify the case was created with variants
  const vepCase = await window.evaluate(async () => {
    const cases = await (window as any).api.cases.list()
    return cases.find((c: { name: string }) => c.name === 'e2e-vep-annotated')
  })

  expect(vepCase).toBeDefined()
  expect(vepCase.variant_count).toBeGreaterThan(100)
})

test('Import SnpEff-annotated VCF and verify import succeeds', async () => {
  const vcfPath = resolve(VCF_DIR, 'trio-region.snpeff.vcf.gz')

  const result = await window.evaluate(async (filePath: string) => {
    return await (window as any).api.import.start(filePath, 'e2e-snpeff-annotated')
  }, vcfPath)

  expect(result.variantCount).toBeGreaterThan(100)
  expect(result.errors).toHaveLength(0)

  // Verify the case was created with variants
  const snpeffCase = await window.evaluate(async () => {
    const cases = await (window as any).api.cases.list()
    return cases.find((c: { name: string }) => c.name === 'e2e-snpeff-annotated')
  })

  expect(snpeffCase).toBeDefined()
  expect(snpeffCase.variant_count).toBeGreaterThan(100)
})

test('Cleanup: delete imported cases', async () => {
  const cases = await window.evaluate(async () => {
    return await (window as any).api.cases.list()
  })

  for (const c of cases.filter((c: { name: string }) => c.name.startsWith('e2e-'))) {
    await window.evaluate(async (caseId: number) => {
      await (window as any).api.cases.delete(caseId)
    }, c.id)
  }

  const remaining = await window.evaluate(async () => {
    return await (window as any).api.cases.list()
  })
  const e2eCases = remaining.filter((c: { name: string }) => c.name.startsWith('e2e-'))
  expect(e2eCases).toHaveLength(0)
})
