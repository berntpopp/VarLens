/**
 * Table interactions measured by the interaction-quality gates in
 * renderer-perf-phase1.e2e.ts. Each step performs ONE user input and waits
 * until the table is settled, so a PerformanceObserver window around it
 * captures exactly that interaction's layout shifts and event timing.
 */
import { expect, type Locator, type Page } from '@playwright/test'
import { waitForQuiet } from './interaction-metrics'

export interface InteractionStep {
  name: string
  run: (window: Page) => Promise<void>
}

const ROWS = '.v-main tbody tr.v-data-table__tr'

export function sortableHeader(window: Page, label: string): Locator {
  return window.locator('.v-main thead th').filter({ hasText: new RegExp(`^\\s*${label}`) }).first()
}

export async function settleTable(window: Page): Promise<void> {
  await expect(window.locator(ROWS).first()).toBeVisible({ timeout: 15_000 })
  await waitForQuiet(window)
}

async function clickHeader(window: Page, label: string): Promise<void> {
  await sortableHeader(window, label).click({ position: { x: 12, y: 12 } })
  await settleTable(window)
}

/** The details panel overlays the pagination at 1280 px (scaling, track 3). */
export async function closeDetailsPanel(window: Page): Promise<void> {
  // Closed drawers stay in the DOM translated off-screen; the --active class is the state.
  const panel = window.locator('aside[aria-label="Variant details"].v-navigation-drawer--active')
  if ((await panel.count()) === 0) return
  await panel.getByRole('button', { name: 'Close variant details' }).click()
  await expect(panel).toHaveCount(0)
  await waitForQuiet(window, 300)
}

/** Position (genomic coordinate) shown in the first rendered row. */
export async function firstRenderedPosition(window: Page): Promise<number> {
  const headers = await window.locator('.v-main thead th').allTextContents()
  const index = headers.findIndex((text) => text.trim().startsWith('Position'))
  if (index < 0) throw new Error(`no Position column in ${JSON.stringify(headers)}`)
  const text = await window.locator(ROWS).first().locator('td').nth(index).textContent()
  return Number((text ?? '').replace(/[^0-9]/g, ''))
}

export const CASE_TABLE_STEPS: readonly InteractionStep[] = [
  { name: 'case-sort', run: async (w) => await clickHeader(w, 'Gene') },
  {
    name: 'case-page-next',
    run: async (w) => {
      await w.getByLabel('Next page').click()
      await settleTable(w)
    }
  },
  {
    name: 'case-page-prev',
    run: async (w) => {
      await w.getByLabel('Previous page').click()
      await settleTable(w)
    }
  },
  {
    name: 'case-row-select',
    run: async (w) => {
      await w.locator(ROWS).nth(2).locator('td').nth(5).click()
      await waitForQuiet(w)
    }
  },
  {
    name: 'case-row-select-again',
    run: async (w) => {
      await w.locator(ROWS).nth(4).locator('td').nth(5).click()
      await waitForQuiet(w)
    }
  }
]

export const COHORT_TABLE_STEPS: readonly InteractionStep[] = [
  { name: 'cohort-sort', run: async (w) => await clickHeader(w, 'Gene') },
  {
    name: 'cohort-page-next',
    run: async (w) => {
      await w.getByLabel('Next page').click()
      await settleTable(w)
    }
  }
]
