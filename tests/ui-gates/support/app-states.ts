/**
 * Drives the web app into the five audited key states. Every helper waits
 * for the state to be visually settled (no skeleton, network idle) so axe
 * and Lighthouse snapshots see the same DOM a user does.
 */
import { expect, type Page } from '@playwright/test'
import { GATE_CASE_NAMES } from './gate-server'

export type GateTheme = 'light' | 'dark'
export type GateStateName = 'login' | 'home' | 'case-table' | 'case-details-panel' | 'cohort'

export const GATE_STATES: readonly GateStateName[] = [
  'login',
  'home',
  'case-table',
  'case-details-panel',
  'cohort'
]

const VUETIFY_THEME: Record<GateTheme, string> = { light: 'warmLight', dark: 'warmDark' }

export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle').catch(() => undefined)
  await expect(page.locator('.v-skeleton-loader:visible')).toHaveCount(0, { timeout: 15_000 })
  // Let Vuetify transitions (drawers, tabs) finish before snapshotting.
  await page.waitForTimeout(400)
}

/**
 * Force the app theme. The signed-in app has no theme toggle yet (track 4
 * adds one), so this switches the Vuetify instance directly; the login page
 * follows `prefers-color-scheme`, which is emulated for both.
 */
export async function applyTheme(page: Page, theme: GateTheme): Promise<void> {
  await page.emulateMedia({ colorScheme: theme })
  if (
    !(await page
      .locator('.v-application')
      .isVisible()
      .catch(() => false))
  )
    return
  const themeName = VUETIFY_THEME[theme]
  const applied = await page.evaluate((name) => {
    type ThemeApi = { change: (n: string) => void }
    const host = document.querySelector('#app') as
      (Element & { __vue_app__?: { _context: { provides: Record<symbol, unknown> } } }) | null
    const provides = host?.__vue_app__?._context.provides
    if (provides === undefined) return false
    const key = Object.getOwnPropertySymbols(provides).find(
      (symbol) => symbol.description === 'vuetify:theme'
    )
    const themeApi = key === undefined ? undefined : (provides[key] as ThemeApi | undefined)
    themeApi?.change(name)
    return themeApi !== undefined
  }, themeName)
  expect(applied, 'Vuetify theme API reachable').toBe(true)
  await expect(page.locator('.v-application').first()).toHaveClass(
    new RegExp(`v-theme--${themeName}`)
  )
  await page.waitForTimeout(300)
}

async function openCase(page: Page, caseName: string): Promise<void> {
  const sidebarToggle = page.getByLabel('Open sidebar')
  if (await sidebarToggle.isVisible().catch(() => false)) await sidebarToggle.click()
  await page
    .locator('.v-navigation-drawer .v-list-item')
    .filter({ hasText: caseName })
    .first()
    .click()
  const tabs = page.locator('.variant-type-tabs .v-tab')
  await expect(tabs.first()).toBeVisible({ timeout: 15_000 })
  if ((await tabs.count()) > 1 && ((await tabs.nth(0).textContent()) ?? '').includes('Shortlist')) {
    await tabs.nth(1).click()
  }
  await expect(page.locator('.v-main tbody tr').first()).toBeVisible({ timeout: 15_000 })
}

export async function gotoState(page: Page, state: GateStateName): Promise<void> {
  if (state === 'login') {
    await page.goto('/login')
    await expect(page.locator('#login-form input[type="password"]')).toBeVisible()
    await settle(page)
    return
  }

  await page.goto('/')
  await expect(page.locator('.v-app-bar')).toBeVisible({ timeout: 30_000 })
  await settle(page)
  if (state === 'home') return

  await openCase(page, GATE_CASE_NAMES[0])
  await settle(page)
  if (state === 'case-table') return

  if (state === 'case-details-panel') {
    await page.locator('.v-main tbody tr.v-data-table__tr').nth(1).locator('td').nth(3).click()
    await expect(page.getByText('Variant Details', { exact: true })).toBeVisible({
      timeout: 15_000
    })
    await settle(page)
    return
  }

  await page.getByRole('button', { name: 'Cohort mode' }).click()
  await expect(page.locator('.v-main tbody tr').first()).toBeVisible({ timeout: 15_000 })
  await settle(page)
}
