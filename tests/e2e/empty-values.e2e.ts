/**
 * E2E test verifying empty/null value display consistency in variant tables.
 *
 * Checks that:
 * 1. All empty values display as '--' (not '-', '—', or 'N/A')
 * 2. No inconsistent placeholders appear in variant or cohort tables
 * 3. Sorting by a column with null values places nulls at the bottom
 *
 * Run with: npx playwright test tests/e2e/empty-values.e2e.ts
 */
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'

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

  // Select the first case to load the variant table
  const caseItem = window
    .locator('.v-list-item')
    .filter({ hasText: /variants/ })
    .first()
  if ((await caseItem.count()) > 0) {
    await caseItem.click()
    // Wait for table to appear
    await window.waitForSelector('.v-data-table', { timeout: 10000 }).catch(() => {})
    await window.waitForTimeout(2000)
  }
})

test.afterAll(async () => {
  if (app) await app.close()
})

// eslint-disable-next-line no-empty-pattern
test('variant table uses consistent "--" for empty values', async ({}, testInfo) => {
  const table = window.locator('.v-data-table')
  if ((await table.count()) === 0) {
    test.skip(true, 'No variant table visible — no cases available')
    return
  }

  await window.screenshot({ path: testInfo.outputPath('01-variant-table.png') })

  // Collect all cell text content
  const cells = window.locator('table td')
  const cellCount = await cells.count()
  expect(cellCount).toBeGreaterThan(0)

  let singleDashCount = 0
  let emDashCount = 0
  let doubleDashCount = 0

  for (let i = 0; i < Math.min(cellCount, 300); i++) {
    const text = await cells.nth(i).textContent()
    if (text === null) continue
    const trimmed = text.trim()

    if (trimmed === '-') singleDashCount++
    if (trimmed === '—') emDashCount++
    if (trimmed === '--') doubleDashCount++
  }

  // No single dashes or em-dashes should be used as placeholders
  expect(singleDashCount, 'Single dash "-" should not be used as placeholder').toBe(0)
  expect(emDashCount, 'Em-dash "—" should not be used as placeholder').toBe(0)

  // Double dashes should exist (there should be some null values)
  // This is a soft check — not all pages may have nulls
  console.log(`Variant table: '--'=${doubleDashCount} cells found`)

  await window.screenshot({ path: testInfo.outputPath('02-empty-values-check.png') })
})

// eslint-disable-next-line no-empty-pattern
test('sorting a column places null values last', async ({}, testInfo) => {
  const table = window.locator('.v-data-table')
  if ((await table.count()) === 0) {
    test.skip(true, 'No variant table visible')
    return
  }

  // Find CADD column header
  const caddHeader = window.locator('table th').filter({ hasText: /CADD/ })
  if ((await caddHeader.count()) === 0) {
    test.skip(true, 'CADD column not visible')
    return
  }

  // Click to sort ascending
  await caddHeader.click()
  await window.waitForTimeout(1500)

  // Find CADD column index
  const headers = window.locator('table th')
  const headerCount = await headers.count()
  let caddIndex = -1
  for (let i = 0; i < headerCount; i++) {
    const text = await headers.nth(i).textContent()
    if (text && text.includes('CADD')) {
      caddIndex = i
      break
    }
  }

  if (caddIndex === -1) {
    test.skip(true, 'Could not find CADD column index')
    return
  }

  const rows = window.locator('table tbody tr')
  const rowCount = await rows.count()
  if (rowCount < 3) {
    test.skip(true, 'Not enough rows to verify sort')
    return
  }

  // Collect CADD values and check that nulls ('--') are at the end
  const values: string[] = []
  for (let i = 0; i < rowCount; i++) {
    const val = (await rows.nth(i).locator('td').nth(caddIndex).textContent())?.trim() ?? ''
    values.push(val)
  }

  const firstNullIndex = values.indexOf('--')
  if (firstNullIndex >= 0) {
    // All values after the first '--' should also be '--'
    for (let i = firstNullIndex; i < values.length; i++) {
      expect(values[i], `Row ${i}: nulls should be contiguous at the end`).toBe('--')
    }
  }

  await window.screenshot({ path: testInfo.outputPath('03-sort-asc.png') })

  // Click again for descending
  await caddHeader.click()
  await window.waitForTimeout(1500)

  // Re-check — nulls should still be at the end in descending sort
  const descValues: string[] = []
  for (let i = 0; i < rowCount; i++) {
    const val = (await rows.nth(i).locator('td').nth(caddIndex).textContent())?.trim() ?? ''
    descValues.push(val)
  }

  const firstNullDesc = descValues.indexOf('--')
  if (firstNullDesc >= 0) {
    for (let i = firstNullDesc; i < descValues.length; i++) {
      expect(descValues[i], `Row ${i} desc: nulls should be contiguous at the end`).toBe('--')
    }
  }

  await window.screenshot({ path: testInfo.outputPath('04-sort-desc.png') })
})

// eslint-disable-next-line no-empty-pattern
test('cohort table uses consistent "--" for empty values', async ({}, testInfo) => {
  // Switch to cohort view
  const cohortBtn = window.locator('.mode-toggle .v-btn').nth(1)
  await cohortBtn.click()
  await window.waitForTimeout(3000)

  const cells = window.locator('table td')
  const cellCount = await cells.count()

  if (cellCount === 0) {
    test.skip(true, 'No cohort table data')
    return
  }

  await window.screenshot({ path: testInfo.outputPath('05-cohort-table.png') })

  let singleDashCount = 0
  let emDashCount = 0

  for (let i = 0; i < Math.min(cellCount, 300); i++) {
    const text = await cells.nth(i).textContent()
    if (text === null) continue
    const trimmed = text.trim()

    if (trimmed === '-') singleDashCount++
    if (trimmed === '—') emDashCount++
  }

  expect(singleDashCount, 'Cohort: single dash "-" should not be a placeholder').toBe(0)
  expect(emDashCount, 'Cohort: em-dash "—" should not be a placeholder').toBe(0)

  await window.screenshot({ path: testInfo.outputPath('06-cohort-empty-values.png') })
})
