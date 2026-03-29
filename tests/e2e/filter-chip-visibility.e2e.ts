/**
 * E2E test: Filter chip visibility and contrast.
 *
 * Run with: npx playwright test tests/e2e/filter-chip-visibility.e2e.ts
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
    env: { ...process.env, NODE_ENV: 'production' }
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

/** Calculate WCAG contrast ratio between two RGB colors */
function contrastRatio(bg: number[], fg: number[]): number {
  const lum = (r: number, g: number, b: number) => {
    const [rs, gs, bs] = [r, g, b].map((c) => {
      c = c / 255
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    })
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs
  }
  const l1 = lum(bg[0], bg[1], bg[2])
  const l2 = lum(fg[0], fg[1], fg[2])
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

// eslint-disable-next-line no-empty-pattern
test('Case view: screenshot active filter chips', async ({}, testInfo) => {
  // Click first case
  const caseItems = window.locator('.v-navigation-drawer .v-list-item')
  if ((await caseItems.count()) === 0) {
    test.skip()
    return
  }
  await caseItems.first().click()
  await window.waitForTimeout(1500)

  // Apply a filter by clicking "Starred" toggle or an ACMG chip
  // First, let's try clicking an ACMG filter chip if visible
  const acmgChips = window.locator(
    '.v-chip:has-text("LP"), .v-chip:has-text("VUS"), .v-chip:has-text("P")'
  )
  if ((await acmgChips.count()) > 0) {
    await acmgChips.first().click()
    await window.waitForTimeout(500)
  }

  await window.screenshot({ path: testInfo.outputPath('01-case-with-filter.png') })

  // Get all visible chips and their styles
  const allChips = window.locator('.v-chip:visible')
  const chipCount = await allChips.count()
  console.log(`\nCase view: ${chipCount} visible chips`)

  for (let i = 0; i < chipCount; i++) {
    const info = await allChips.nth(i).evaluate((el) => {
      const cs = globalThis.getComputedStyle(el)
      const bgParts = cs.backgroundColor.match(/[\d.]+/g)
      const fgParts = cs.color.match(/[\d.]+/g)
      return {
        text: el.textContent?.trim().substring(0, 40) || '',
        bg: bgParts ? bgParts.slice(0, 3).map(Number) : null,
        fg: fgParts ? fgParts.slice(0, 3).map(Number) : null,
        bgRaw: cs.backgroundColor,
        fgRaw: cs.color,
        classes: Array.from(el.classList)
          .filter((c) => c.startsWith('v-chip'))
          .join(' ')
      }
    })

    if (info.bg && info.fg) {
      const ratio = contrastRatio(info.bg, info.fg)
      const pass = ratio >= 4.5 ? 'PASS' : 'FAIL'
      console.log(
        `  [${pass}] "${info.text}" contrast=${ratio.toFixed(1)}:1 bg=${info.bgRaw} fg=${info.fgRaw} ${info.classes}`
      )
    } else {
      console.log(`  [????] "${info.text}" bg=${info.bgRaw} fg=${info.fgRaw}`)
    }
  }

  // Assert: all flat-variant chips (active filters) must meet WCAG AA (4.5:1)
  const flatChips = window.locator('.v-chip--variant-flat:visible')
  const flatCount = await flatChips.count()
  for (let i = 0; i < flatCount; i++) {
    const info = await flatChips.nth(i).evaluate((el) => {
      const cs = globalThis.getComputedStyle(el)
      const bgParts = cs.backgroundColor.match(/[\d.]+/g)
      const fgParts = cs.color.match(/[\d.]+/g)
      return {
        text: el.textContent?.trim().substring(0, 40) || '',
        bg: bgParts ? bgParts.slice(0, 3).map(Number) : null,
        fg: fgParts ? fgParts.slice(0, 3).map(Number) : null
      }
    })
    if (info.bg && info.fg) {
      const ratio = contrastRatio(info.bg, info.fg)
      expect(
        ratio,
        `Flat chip "${info.text}" contrast must be >= 4.5:1, got ${ratio.toFixed(1)}:1`
      ).toBeGreaterThanOrEqual(4.5)
    }
  }

  // Click the chip again to deselect
  if ((await acmgChips.count()) > 0) {
    await acmgChips.first().click()
    await window.waitForTimeout(300)
  }
})

// eslint-disable-next-line no-empty-pattern
test('Cohort view: screenshot active filter chips', async ({}, testInfo) => {
  // Navigate to Cohort
  await window.locator('button:has-text("Cohort")').click()
  await window.waitForTimeout(1500)

  // Apply a gene filter via evaluate to trigger active state
  await window.evaluate(() => {
    // Try to set a filter via the store
    const app = document.querySelector('#app')?.__vue_app__
    if (!app) return
    const pinia = app.config.globalProperties.$pinia
    if (!pinia?.state?.value) return

    // Look for filter-related stores
    const keys = Object.keys(pinia.state.value)
    console.log('Pinia stores:', keys.join(', '))
  })

  // Try clicking an ACMG chip in cohort view
  const acmgChips = window.locator(
    '.v-chip:has-text("LP"), .v-chip:has-text("VUS"), .v-chip:has-text("P")'
  )
  if ((await acmgChips.count()) > 0) {
    await acmgChips.first().click()
    await window.waitForTimeout(800)
  }

  await window.screenshot({ path: testInfo.outputPath('02-cohort-with-filter.png') })

  // Check all visible chips
  const allChips = window.locator('.v-chip:visible')
  const chipCount = await allChips.count()
  console.log(`\nCohort view: ${chipCount} visible chips`)

  for (let i = 0; i < chipCount; i++) {
    const info = await allChips.nth(i).evaluate((el) => {
      const cs = globalThis.getComputedStyle(el)
      const bgParts = cs.backgroundColor.match(/[\d.]+/g)
      const fgParts = cs.color.match(/[\d.]+/g)
      return {
        text: el.textContent?.trim().substring(0, 40) || '',
        bg: bgParts ? bgParts.slice(0, 3).map(Number) : null,
        fg: fgParts ? fgParts.slice(0, 3).map(Number) : null,
        bgRaw: cs.backgroundColor,
        fgRaw: cs.color,
        classes: Array.from(el.classList)
          .filter((c) => c.startsWith('v-chip'))
          .join(' ')
      }
    })

    if (info.bg && info.fg) {
      const ratio = contrastRatio(info.bg, info.fg)
      const pass = ratio >= 4.5 ? 'PASS' : 'FAIL'
      console.log(
        `  [${pass}] "${info.text}" contrast=${ratio.toFixed(1)}:1 bg=${info.bgRaw} fg=${info.fgRaw} ${info.classes}`
      )
    } else {
      console.log(`  [????] "${info.text}" bg=${info.bgRaw} fg=${info.fgRaw}`)
    }
  }

  // Deselect
  if ((await acmgChips.count()) > 0) {
    await acmgChips.first().click()
    await window.waitForTimeout(300)
  }
})
