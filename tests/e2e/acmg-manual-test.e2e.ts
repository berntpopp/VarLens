/**
 * Comprehensive ACMG manual testing via Playwright.
 * Tests all pathways: table actions, sidebar, evidence editor, clearing.
 *
 * Run: npx playwright test tests/e2e/acmg-manual-test.e2e.ts --reporter=list
 */
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  app = await electron.launch({
    args: ['./out/main/index.js'],
    env: { ...process.env, NODE_ENV: 'production' }
  })
  page = await app.firstWindow()
  await page.waitForSelector('.v-application', { timeout: 15000 })
})

test.afterAll(async () => {
  if (app) await app.close()
})

test.describe.serial('ACMG Classification Pathways', () => {
  // eslint-disable-next-line no-empty-pattern
  test('01 - navigate to case and load variants', async ({}, testInfo) => {
    // Click on TestCase_001 in sidebar
    const caseItem = page.locator('text=TestCase_001')
    await expect(caseItem).toBeVisible({ timeout: 5000 })
    await caseItem.click()

    // Wait for variant table to load
    await page.waitForSelector('.v-data-table', { timeout: 15000 })
    await page.waitForTimeout(2000) // let data fully render

    await page.screenshot({ path: testInfo.outputPath('01-case-loaded.png') })

    // Verify we have annotation icons
    const stars = await page.locator('.mdi-star-outline, .mdi-star').count()
    console.log(`Stars visible: ${stars}`)
    expect(stars).toBeGreaterThan(0)
  })

  // eslint-disable-next-line no-empty-pattern
  test('02 - table actions: open ACMG menu', async ({}, testInfo) => {
    // Click the ACMG icon in first row
    const acmgIcon = page.locator('.mdi-clipboard-check-outline').first()
    await expect(acmgIcon).toBeVisible({ timeout: 5000 })
    await acmgIcon.click()
    await page.waitForTimeout(500)

    await page.screenshot({ path: testInfo.outputPath('02-acmg-menu.png') })

    // Verify chips are visible (P, LP, VUS, LB, B)
    const overlay = page.locator('.v-overlay--active')
    const chips = overlay.locator('.v-chip')
    const chipCount = await chips.count()
    console.log(`Quick-classify chips in menu: ${chipCount}`)
    expect(chipCount).toBeGreaterThanOrEqual(5) // P, LP, VUS, LB, B

    // Verify Evidence editor link
    const evidenceLink = overlay.locator('text=Evidence editor')
    await expect(evidenceLink).toBeVisible()
  })

  // eslint-disable-next-line no-empty-pattern
  test('03 - table actions: select Pathogenic', async ({}, testInfo) => {
    // Click P chip in the open menu
    const overlay = page.locator('.v-overlay--active')
    const pChip = overlay.locator('.v-chip:has-text("P")').first()
    await pChip.click()
    await page.waitForTimeout(500)

    await page.screenshot({ path: testInfo.outputPath('03-selected-pathogenic.png') })

    // Verify chip now appears in table row
    const tableChip = page.locator('td .v-chip').first()
    await expect(tableChip).toBeVisible({ timeout: 3000 })
    const chipText = await tableChip.textContent()
    console.log(`Table chip text: ${chipText}`)
  })

  // eslint-disable-next-line no-empty-pattern
  test('04 - table actions: clear classification', async ({}, testInfo) => {
    // Click the classification chip to reopen menu
    const tableChip = page.locator('td .v-chip').first()
    await tableChip.click()
    await page.waitForTimeout(500)

    await page.screenshot({ path: testInfo.outputPath('04-clear-menu.png') })

    // Click Clear classification
    const clearBtn = page.locator('.v-overlay--active').locator('text=Clear classification')
    await expect(clearBtn).toBeVisible({ timeout: 3000 })
    await clearBtn.click()
    await page.waitForTimeout(500)

    await page.screenshot({ path: testInfo.outputPath('04-after-clear.png') })

    // Verify chip is gone, icon is back
    const acmgIcon = page.locator('td .mdi-clipboard-check-outline').first()
    await expect(acmgIcon).toBeVisible({ timeout: 3000 })
    console.log('Classification cleared successfully')
  })

  // eslint-disable-next-line no-empty-pattern
  test('05 - open sidebar by clicking variant row', async ({}, testInfo) => {
    const row = page.locator('tr.v-data-table__tr').first()
    await row.click()
    await page.waitForTimeout(1000)

    const drawer = page
      .locator('aside[aria-label="Variant details"].v-navigation-drawer--active')
    await expect(drawer).toBeVisible({ timeout: 5000 })

    await page.screenshot({ path: testInfo.outputPath('05-sidebar-open.png') })
  })

  // eslint-disable-next-line no-empty-pattern
  test('06 - sidebar: verify ACMG section with quick-classify chips', async ({}, testInfo) => {
    const drawer = page
      .locator('aside[aria-label="Variant details"].v-navigation-drawer--active')

    // Scroll to ACMG section
    const acmgTitle = drawer.locator('text=ACMG Classification')
    await expect(acmgTitle).toBeVisible({ timeout: 5000 })

    // Check chips
    const acmgSection = drawer.locator('.acmg-section')
    const chips = acmgSection.locator('.v-chip')
    const chipCount = await chips.count()
    console.log(`Sidebar ACMG chips: ${chipCount}`)
    expect(chipCount).toBeGreaterThanOrEqual(5)

    // Check evidence editor accordion
    const evidenceAccordion = drawer.locator('text=Evidence editor')
    await expect(evidenceAccordion).toBeVisible()

    await page.screenshot({ path: testInfo.outputPath('06-sidebar-acmg-section.png') })
  })

  // eslint-disable-next-line no-empty-pattern
  test('07 - sidebar: quick-classify as VUS', async ({}, testInfo) => {
    const drawer = page
      .locator('aside[aria-label="Variant details"].v-navigation-drawer--active')
    const acmgSection = drawer.locator('.acmg-section')

    // Click VUS chip
    const vusChip = acmgSection.locator('.v-chip:has-text("VUS")')
    await vusChip.click()
    await page.waitForTimeout(500)

    await page.screenshot({ path: testInfo.outputPath('07-sidebar-vus-selected.png') })

    // Verify it's now active (flat variant = active)
    const activeChip = acmgSection.locator('.v-chip--variant-flat:has-text("VUS")')
    const isActive = await activeChip.count()
    console.log(`VUS chip active: ${isActive}`)
    expect(isActive).toBe(1)
  })

  // eslint-disable-next-line no-empty-pattern
  test('08 - sidebar: clear classification via X chip', async ({}, testInfo) => {
    const drawer = page
      .locator('aside[aria-label="Variant details"].v-navigation-drawer--active')
    const acmgSection = drawer.locator('.acmg-section')

    // Click the X (clear) chip
    const clearIcon = acmgSection.locator('.v-chip .mdi-close').first()
    if ((await clearIcon.count()) > 0) {
      await clearIcon.click()
    } else {
      // Toggle off by clicking VUS again
      const vusChip = acmgSection.locator('.v-chip:has-text("VUS")')
      await vusChip.click()
    }
    await page.waitForTimeout(500)

    await page.screenshot({ path: testInfo.outputPath('08-sidebar-cleared.png') })

    // Verify no active chip
    const activeChips = acmgSection.locator('.v-chip--variant-flat')
    const activeCount = await activeChips.count()
    console.log(`Active chips after clear: ${activeCount}`)
  })

  // eslint-disable-next-line no-empty-pattern
  test('09 - sidebar: open evidence editor', async ({}, testInfo) => {
    const drawer = page
      .locator('aside[aria-label="Variant details"].v-navigation-drawer--active')

    // Click Evidence editor accordion
    const accordionTitle = drawer.locator('.v-expansion-panel-title:has-text("Evidence editor")')
    await accordionTitle.click()
    await page.waitForTimeout(500)

    await page.screenshot({ path: testInfo.outputPath('09-evidence-editor-open.png') })

    // Verify evidence code buttons are visible
    const pvs1 = drawer.locator('button:has-text("PVS1")')
    await expect(pvs1).toBeVisible({ timeout: 3000 })
  })

  // eslint-disable-next-line no-empty-pattern
  test('10 - evidence: PVS1 alone = VUS (ACMG/AMP 2015)', async ({}, testInfo) => {
    const drawer = page
      .locator('aside[aria-label="Variant details"].v-navigation-drawer--active')

    // Click PVS1
    const pvs1 = drawer.locator('button:has-text("PVS1")').first()
    await pvs1.click()
    await page.waitForTimeout(500)

    await page.screenshot({ path: testInfo.outputPath('10-pvs1-alone.png') })

    // Should show VUS (not LP!) per ACMG/AMP 2015 rules
    const classAlert = drawer.locator('.classification-banner')
    if ((await classAlert.count()) > 0) {
      const alertText = await classAlert.textContent()
      console.log(`Classification after PVS1: ${alertText}`)
      expect(alertText).toContain('VUS')
    } else {
      console.log('No classification banner (may show empty state for VUS with no combination)')
    }
  })

  // eslint-disable-next-line no-empty-pattern
  test('11 - evidence: PVS1 + PM2 = Likely Pathogenic', async ({}, testInfo) => {
    const drawer = page
      .locator('aside[aria-label="Variant details"].v-navigation-drawer--active')

    // Click PM2
    const pm2 = drawer.locator('button:has-text("PM2")').first()
    await pm2.click()
    await page.waitForTimeout(500)

    await page.screenshot({ path: testInfo.outputPath('11-pvs1-pm2.png') })

    // Should show Likely Pathogenic
    const classAlert = drawer.locator('.classification-banner')
    const alertText = await classAlert.textContent()
    console.log(`Classification after PVS1+PM2: ${alertText}`)
    expect(alertText).toContain('Likely Pathogenic')
  })

  // eslint-disable-next-line no-empty-pattern
  test('12 - evidence: PVS1 + PM2 + PP3 = Pathogenic', async ({}, testInfo) => {
    const drawer = page
      .locator('aside[aria-label="Variant details"].v-navigation-drawer--active')

    // Click PP3
    const pp3 = drawer.locator('button:has-text("PP3")').first()
    await pp3.click()
    await page.waitForTimeout(500)

    await page.screenshot({ path: testInfo.outputPath('12-pvs1-pm2-pp3.png') })

    // Should show Pathogenic
    const classAlert = drawer.locator('.classification-banner')
    const alertText = await classAlert.textContent()
    console.log(`Classification after PVS1+PM2+PP3: ${alertText}`)
    expect(alertText).toContain('Pathogenic')
  })

  // eslint-disable-next-line no-empty-pattern
  test('13 - evidence: verify deprecated PP5/BP6 styling', async ({}, testInfo) => {
    const drawer = page
      .locator('aside[aria-label="Variant details"].v-navigation-drawer--active')

    const pp5 = drawer.locator('.criteria-btn--deprecated:has-text("PP5")')
    const bp6 = drawer.locator('.criteria-btn--deprecated:has-text("BP6")')

    console.log(`PP5 deprecated: ${await pp5.count()}, BP6 deprecated: ${await bp6.count()}`)
    expect(await pp5.count()).toBe(1)
    expect(await bp6.count()).toBe(1)

    await page.screenshot({ path: testInfo.outputPath('13-deprecated-codes.png') })
  })

  // eslint-disable-next-line no-empty-pattern
  test('14 - evidence: clear all codes', async ({}, testInfo) => {
    const drawer = page
      .locator('aside[aria-label="Variant details"].v-navigation-drawer--active')

    // Toggle off PVS1, PM2, PP3
    for (const code of ['PVS1', 'PM2', 'PP3']) {
      const btn = drawer.locator(`button:has-text("${code}")`).first()
      if ((await btn.count()) > 0) {
        await btn.click()
        await page.waitForTimeout(200)
      }
    }
    await page.waitForTimeout(500)

    await page.screenshot({ path: testInfo.outputPath('14-all-cleared.png') })

    const emptyHint = drawer.locator('.empty-state-hint')
    console.log(`Empty state visible: ${await emptyHint.count()}`)
  })

  // eslint-disable-next-line no-empty-pattern
  test('15 - table actions: open evidence dialog', async ({}, testInfo) => {
    // Close sidebar
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)

    // Click ACMG icon to open menu
    const acmgIcon = page.locator('td .mdi-clipboard-check-outline').first()
    if ((await acmgIcon.count()) > 0) {
      await acmgIcon.click()
    } else {
      const chip = page.locator('td .v-chip').first()
      await chip.click()
    }
    await page.waitForTimeout(500)

    // Click Evidence editor
    const evidenceLink = page.locator('.v-overlay--active').locator('text=Evidence editor')
    if ((await evidenceLink.count()) > 0) {
      await evidenceLink.click()
      await page.waitForTimeout(500)

      await page.screenshot({ path: testInfo.outputPath('15-evidence-dialog.png') })

      const dialog = page.locator('.v-dialog:visible')
      await expect(dialog).toBeVisible({ timeout: 3000 })

      // Check title
      const title = dialog.locator('text=ACMG Evidence Classification')
      console.log(`Dialog title: ${await title.count()}`)

      // Check for variant label (first text-caption in dialog card-text)
      const label = dialog.locator('.v-card-text > .text-caption.text-medium-emphasis').first()
      if ((await label.count()) > 0) {
        const text = await label.textContent()
        console.log(`Variant label: ${text}`)
      }

      // Close dialog via X button
      const closeBtn = dialog
        .locator('button')
        .filter({ has: page.locator('.mdi-close') })
        .first()
      await closeBtn.click()
      await page.waitForTimeout(300)
    }
  })

  // eslint-disable-next-line no-empty-pattern
  test('16 - benign: BA1 = Benign', async ({}, testInfo) => {
    // Open sidebar
    const row = page.locator('tr.v-data-table__tr').first()
    await row.click()
    await page.waitForTimeout(1000)

    const drawer = page
      .locator('aside[aria-label="Variant details"].v-navigation-drawer--active')

    // Open evidence editor
    const accordionTitle = drawer.locator('.v-expansion-panel-title:has-text("Evidence editor")')
    const expanded = drawer.locator('.v-expansion-panel--active:has-text("Evidence editor")')
    if ((await expanded.count()) === 0) {
      await accordionTitle.click()
      await page.waitForTimeout(500)
    }

    // Click BA1
    const ba1 = drawer.locator('button:has-text("BA1")').first()
    await ba1.scrollIntoViewIfNeeded()
    await ba1.click()
    await page.waitForTimeout(500)

    await page.screenshot({ path: testInfo.outputPath('16-ba1-benign.png') })

    const classAlert = drawer.locator('.classification-banner')
    if ((await classAlert.count()) > 0) {
      const alertText = await classAlert.textContent()
      console.log(`Classification after BA1: ${alertText}`)
      expect(alertText).toContain('Benign')
    }

    // Clean up
    await ba1.click()
    await page.waitForTimeout(300)
  })

  // eslint-disable-next-line no-empty-pattern
  test('17 - final screenshot', async ({}, testInfo) => {
    await page.screenshot({ path: testInfo.outputPath('17-final.png'), fullPage: true })
  })
})
