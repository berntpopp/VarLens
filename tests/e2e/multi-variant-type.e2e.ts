/**
 * E2E test: Multi-variant type import and display.
 *
 * Tests the full Phase 1-3 stack:
 * - Importing SV/CNV/STR VCFs via the backend IPC (import:start)
 * - Variant type counts query returns per-type counts
 * - UI renders variant type tabs when a case has SV/CNV/STR data
 * - Tab switching swaps column sets
 * - Visual snapshots for UX verification
 *
 * Run with: xvfb-run --auto-servernum npx playwright test tests/e2e/multi-variant-type.e2e.ts
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

const CASE_PREFIX = 'E2EMultiType'

/** Delete any leftover test cases from previous runs */
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

test('Import SV VCF and verify SV type count', async () => {
  const svPath = resolve(VCF_DIR, 'synthetic-sv.vcf')
  const caseName = `${CASE_PREFIX}_SV`

  const result = await window.evaluate(
    async ([filePath, name]: [string, string]) => {
      const w = window as unknown as {
        api: {
          import: {
            start: (
              filePath: string,
              caseName: string
            ) => Promise<{ caseId: number; variantCount: number }>
          }
        }
      }
      return await w.api.import.start(filePath, name)
    },
    [svPath, caseName] as [string, string]
  )

  expect(result.caseId).toBeGreaterThan(0)
  expect(result.variantCount).toBeGreaterThan(0)

  // Check type counts
  const counts = await window.evaluate(async (id: number) => {
    const w = window as unknown as {
      api: { variants: { typeCounts: (caseId: number) => Promise<Record<string, number>> } }
    }
    return await w.api.variants.typeCounts(id)
  }, result.caseId)

  console.log('SV case type counts:', counts)
  expect(counts.sv ?? 0).toBeGreaterThanOrEqual(1)

  // Store for next test
  await window.evaluate((id: number) => {
    ;(window as unknown as { __svCaseId: number }).__svCaseId = id
  }, result.caseId)
})

test('Import CNV VCF and verify CNV type count', async () => {
  const cnvPath = resolve(VCF_DIR, 'synthetic-cnv.vcf')
  const caseName = `${CASE_PREFIX}_CNV`

  const result = await window.evaluate(
    async ([filePath, name]: [string, string]) => {
      const w = window as unknown as {
        api: {
          import: {
            start: (
              filePath: string,
              caseName: string
            ) => Promise<{ caseId: number; variantCount: number }>
          }
        }
      }
      return await w.api.import.start(filePath, name)
    },
    [cnvPath, caseName] as [string, string]
  )

  expect(result.caseId).toBeGreaterThan(0)
  expect(result.variantCount).toBeGreaterThan(0)

  const counts = await window.evaluate(async (id: number) => {
    const w = window as unknown as {
      api: { variants: { typeCounts: (caseId: number) => Promise<Record<string, number>> } }
    }
    return await w.api.variants.typeCounts(id)
  }, result.caseId)

  console.log('CNV case type counts:', counts)
  expect(counts.cnv ?? 0).toBeGreaterThanOrEqual(1)

  await window.evaluate((id: number) => {
    ;(window as unknown as { __cnvCaseId: number }).__cnvCaseId = id
  }, result.caseId)
})

test('Import STR VCF and verify STR type count', async () => {
  const strPath = resolve(VCF_DIR, 'synthetic-str.vcf')
  const caseName = `${CASE_PREFIX}_STR`

  const result = await window.evaluate(
    async ([filePath, name]: [string, string]) => {
      const w = window as unknown as {
        api: {
          import: {
            start: (
              filePath: string,
              caseName: string
            ) => Promise<{ caseId: number; variantCount: number }>
          }
        }
      }
      return await w.api.import.start(filePath, name)
    },
    [strPath, caseName] as [string, string]
  )

  expect(result.caseId).toBeGreaterThan(0)
  expect(result.variantCount).toBeGreaterThan(0)

  const counts = await window.evaluate(async (id: number) => {
    const w = window as unknown as {
      api: { variants: { typeCounts: (caseId: number) => Promise<Record<string, number>> } }
    }
    return await w.api.variants.typeCounts(id)
  }, result.caseId)

  console.log('STR case type counts:', counts)
  expect(counts.str ?? 0).toBeGreaterThanOrEqual(1)

  await window.evaluate((id: number) => {
    ;(window as unknown as { __strCaseId: number }).__strCaseId = id
  }, result.caseId)
})

test('Variant query with variant_type filter returns typed variants', async () => {
  const svCaseId = await window.evaluate(
    () => (window as unknown as { __svCaseId: number }).__svCaseId
  )

  // Query SV variants
  const svResult = await window.evaluate(async (id: number) => {
    const w = window as unknown as {
      api: {
        variants: {
          query: (
            caseId: number,
            filters: Record<string, unknown>,
            offset: number,
            limit: number
          ) => Promise<{ data: Array<Record<string, unknown>>; total_count: number }>
        }
      }
    }
    return await w.api.variants.query(id, { variant_type: 'sv' }, 0, 100)
  }, svCaseId)

  expect(svResult.total_count).toBeGreaterThan(0)
  // All returned variants should have variant_type 'sv' and extension fields
  for (const v of svResult.data) {
    expect(v.variant_type).toBe('sv')
  }
})

test('Cohort availableBuilds returns build with case count', async () => {
  const builds = await window.evaluate(async () => {
    const w = window as unknown as {
      api: {
        cases: {
          availableBuilds: () => Promise<Array<{ build: string; caseCount: number }>>
        }
      }
    }
    return await w.api.cases.availableBuilds()
  })

  expect(builds.length).toBeGreaterThanOrEqual(1)
  expect(builds[0].build).toBeTruthy()
  expect(builds[0].caseCount).toBeGreaterThanOrEqual(1)
})

test('Visual: select CNV case and verify CNV tab appears', async () => {
  // Wait for cases list to refresh
  await window.waitForTimeout(500)

  // Make sure we're on the Case view
  const caseNavBtn = window
    .locator('button:has(.v-btn__content:has-text("Case"))')
    .first()
  if ((await caseNavBtn.count()) > 0) {
    await caseNavBtn.click()
    await window.waitForTimeout(300)
  }

  // Use the case list search box to filter down to the CNV case
  const searchInput = window.locator('.v-navigation-drawer input[type="text"]').first()
  if ((await searchInput.count()) > 0) {
    await searchInput.click()
    await searchInput.fill(`${CASE_PREFIX}_CNV`)
    await window.waitForTimeout(800) // Debounced search
  }

  // Click on the CNV case item in the filtered list
  const cnvCaseItem = window
    .locator('.v-list-item')
    .filter({ hasText: `${CASE_PREFIX}_CNV` })
    .first()
  const count = await cnvCaseItem.count()
  console.log(`Found ${count} items matching ${CASE_PREFIX}_CNV`)
  if (count > 0) {
    await cnvCaseItem.click()
    await window.waitForTimeout(1500) // Let tabs load
  }

  // Take a screenshot of the case view
  await window.screenshot({
    path: 'test-results/cnv-case-view.png',
    fullPage: true
  })

  // Verify CNV tab appears
  const cnvTab = window.locator('.v-tab').filter({ hasText: 'CNV' })
  const tabCount = await cnvTab.count()
  console.log(`CNV tabs visible: ${tabCount}`)
  expect(tabCount).toBeGreaterThan(0)

  // Click the CNV tab and verify CNV-specific column appears
  await cnvTab.first().click()
  await window.waitForTimeout(800)
  await window.screenshot({
    path: 'test-results/cnv-case-view-cnv-tab-active.png',
    fullPage: true
  })

  // Check for Copy Number column header
  const cnColumn = window.locator('th').filter({ hasText: 'Copy Number' })
  const cnColumnCount = await cnColumn.count()
  console.log(`Copy Number column visible: ${cnColumnCount}`)
  expect(cnColumnCount).toBeGreaterThan(0)
})

test('Backend: STR case has disease, inheritance, and status fields populated', async () => {
  const strCaseId = await window.evaluate(
    () => (window as unknown as { __strCaseId: number }).__strCaseId
  )

  // Query STR variants and verify extension fields
  const result = await window.evaluate(async (id: number) => {
    const w = window as unknown as {
      api: {
        variants: {
          query: (
            caseId: number,
            filters: Record<string, unknown>,
            offset: number,
            limit: number
          ) => Promise<{ data: Array<Record<string, unknown>>; total_count: number }>
        }
      }
    }
    return await w.api.variants.query(id, { variant_type: 'str' }, 0, 10)
  }, strCaseId)

  expect(result.total_count).toBeGreaterThan(0)

  // Verify at least one variant has the STR extension fields populated
  const withDisease = result.data.filter((v) => v._str_disease !== null && v._str_disease !== undefined)
  expect(withDisease.length).toBeGreaterThan(0)

  const diseases = withDisease.map((v) => v._str_disease as string)
  console.log('STR diseases found:', diseases)
  expect(diseases).toContain('MJD')

  // Verify status field is populated (normal/pre_mutation/full_mutation)
  const withStatus = result.data.filter(
    (v) => v._str_status !== null && v._str_status !== undefined
  )
  expect(withStatus.length).toBeGreaterThan(0)
})

test('Visual: cohort view with selectors', async () => {
  // Navigate to cohort view
  const cohortBtn = window.locator('button:has-text("Cohort")').first()
  if ((await cohortBtn.count()) > 0) {
    await cohortBtn.click()
    await window.waitForTimeout(1000)
  }

  await window.screenshot({
    path: 'test-results/cohort-view-selectors.png',
    fullPage: true
  })

  // Check if the dropdowns are visible
  const buildSelector = window.locator('label:has-text("Genome Build")').first()
  const typeSelector = window.locator('label:has-text("Variant Type")').first()

  const buildVisible = await buildSelector.count()
  const typeVisible = await typeSelector.count()
  console.log(`Cohort selectors — Build: ${buildVisible}, Type: ${typeVisible}`)
})

test('Cleanup: delete test cases', async () => {
  await cleanupTestCases()
})
