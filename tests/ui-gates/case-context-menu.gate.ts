/**
 * Case-list context menu gate: the menu must open at the cursor (not
 * bottom-centre of the viewport, the Vuetify 4 static-strategy regression),
 * stay inside the viewport, be keyboard-operable (Shift+F10 / ContextMenu key,
 * focus moves in, Escape returns focus) and have no serious/critical axe
 * violations. Never activates a menu action.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { Pool } from 'pg'
import { settle } from './support/app-states'
import { GATE_STORAGE_STATE_PATH, readGateState } from './support/gate-state'

const EXTRA_CASE_PREFIX = 'ctx-menu-filler-'
const EXTRA_CASES = 40
const TOLERANCE_PX = 4
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const VIEWPORTS = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 }
] as const

const MENU = '.v-overlay--active .v-overlay__content:has([data-testid="case-context-menu"])'

function casesTable(): string {
  return `"${readGateState().schema.replace(/"/g, '')}".cases_all`
}

/** Enough rows to make the sidebar list scroll; removed again in afterAll. */
async function withPool(fn: (pool: Pool) => Promise<void>): Promise<void> {
  const pool = new Pool({ connectionString: process.env.VARLENS_PG_URL })
  try {
    await fn(pool)
  } finally {
    await pool.end()
  }
}

async function openMenuAt(page: Page, item: Locator, rel: { x: number; y: number }) {
  await item.scrollIntoViewIfNeeded()
  const box = await item.boundingBox()
  if (box === null) throw new Error('case item has no box')
  const click = {
    x: Math.round(box.x + box.width * rel.x),
    y: Math.round(box.y + box.height * rel.y)
  }
  await page.mouse.click(click.x, click.y, { button: 'right' })
  const menu = page.locator(MENU)
  await expect(menu).toBeVisible()
  await page.waitForTimeout(300) // open transition
  const menuBox = await menu.boundingBox()
  if (menuBox === null) throw new Error('menu has no box')
  return { click, menuBox }
}

async function closeMenu(page: Page): Promise<void> {
  await page.keyboard.press('Escape')
  await expect(page.locator(MENU)).toBeHidden()
}

test.describe('case list context menu', () => {
  test.use({ storageState: GATE_STORAGE_STATE_PATH })

  test.beforeAll(async () => {
    await withPool(async (pool) => {
      for (let i = 0; i < EXTRA_CASES; i += 1) {
        await pool.query(
          `INSERT INTO ${casesTable()} (name, file_path, file_size, created_at) VALUES ($1, $2, 1, $3)`,
          [`${EXTRA_CASE_PREFIX}${String(i).padStart(2, '0')}`, 'filler.json', i]
        )
      }
    })
  })

  test.afterAll(async () => {
    await withPool(async (pool) => {
      await pool.query(`DELETE FROM ${casesTable()} WHERE name LIKE $1`, [`${EXTRA_CASE_PREFIX}%`])
    })
  })

  for (const viewport of VIEWPORTS) {
    test(`opens at the cursor at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/')
      await settle(page)
      const items = page.locator('[aria-label="Cases"] .v-list-item')
      await expect(items.nth(20)).toBeAttached({ timeout: 15_000 })

      const probes: Array<[string, Locator, { x: number; y: number }]> = [
        ['top', items.nth(0), { x: 0.3, y: 0.5 }],
        ['middle', items.nth(5), { x: 0.8, y: 0.5 }],
        ['scrolled', items.nth(20), { x: 0.5, y: 0.5 }]
      ]
      for (const [label, item, rel] of probes) {
        const { click, menuBox } = await openMenuAt(page, item, rel)
        expect(Math.abs(menuBox.x - click.x), `${label} x`).toBeLessThanOrEqual(TOLERANCE_PX)
        expect(Math.abs(menuBox.y - click.y), `${label} y`).toBeLessThanOrEqual(TOLERANCE_PX)
        await closeMenu(page)
      }

      // Near the bottom edge the menu flips/shifts but stays fully visible.
      const last = items.last()
      await last.scrollIntoViewIfNeeded()
      const { menuBox } = await openMenuAt(page, last, { x: 0.5, y: 0.9 })
      expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(viewport.height)
      expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(viewport.width)
      await closeMenu(page)
    })
  }

  test('is keyboard operable and has no serious/critical axe violations', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS[0])
    await page.goto('/')
    await settle(page)
    const item = page.locator('[aria-label="Cases"] .v-list-item').nth(2)
    await item.focus()

    await page.keyboard.press('Shift+F10')
    const menu = page.locator(MENU)
    await expect(menu).toBeVisible()
    const itemBox = await item.boundingBox()
    const menuBox = await menu.boundingBox()
    expect(menuBox!.x).toBeGreaterThanOrEqual(itemBox!.x)
    expect(menuBox!.y).toBeGreaterThanOrEqual(itemBox!.y)
    expect(menuBox!.y).toBeLessThanOrEqual(itemBox!.y + itemBox!.height)
    await expect.poll(() => menu.evaluate((el) => el.contains(document.activeElement))).toBe(true)

    const results = await new AxeBuilder({ page }).include(MENU).withTags(WCAG_TAGS).analyze()
    const blocking = results.violations.filter((v) =>
      ['serious', 'critical'].includes(v.impact ?? '')
    )
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([])

    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect.poll(() => item.evaluate((el) => el === document.activeElement)).toBe(true)

    await page.keyboard.press('ContextMenu')
    await expect(menu).toBeVisible()
    await closeMenu(page)
  })
})
