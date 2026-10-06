/**
 * Lighthouse user flow over the five key states (navigation for cold loads,
 * timespan for interactions, snapshot for the resulting state). Driven by
 * puppeteer-core because Lighthouse's flow API needs a Puppeteer page; the
 * browser binary is Playwright's Chromium so CI installs one browser only.
 */
import { chromium } from '@playwright/test'
import { desktopConfig, startFlow } from 'lighthouse'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import type { FlowStepLike } from '../../../scripts/ui-gates/lighthouse-budgets'
import { GATE_CASE_NAMES, type GateServerState } from './gate-server'
import { DISCLAIMER_STORAGE_KEY } from './gate-state'

export type LighthousePreset = 'desktop' | 'mobile'

export interface FlowRun {
  steps: FlowStepLike[]
  html: string
}

async function idle(page: Page): Promise<void> {
  await page
    .waitForNetworkIdle({ idleTime: 500, concurrency: 0, timeout: 20_000 })
    .catch(() => undefined)
  await new Promise((resolve) => setTimeout(resolve, 400))
}

async function clickByText(page: Page, selector: string, text: string): Promise<void> {
  const handles = await page.$$(selector)
  for (const handle of handles) {
    const matches = await handle.evaluate(
      (el, needle) =>
        (el.textContent ?? '').includes(needle) && el.getBoundingClientRect().width > 0,
      text
    )
    if (matches) {
      await handle.scrollIntoView()
      // Real pointer input (counts toward INP); DOM click only if an overlay
      // transition still covers the element.
      await handle
        .click()
        .catch(async () => await handle.evaluate((el) => (el as HTMLElement).click()))
      return
    }
  }
  throw new Error(`no visible "${selector}" containing "${text}"`)
}

async function openCase(page: Page): Promise<void> {
  const caseName = GATE_CASE_NAMES[0]
  const listed = await page.$$eval(
    '.v-navigation-drawer .v-list-item',
    (items, needle) =>
      items.some((el) => {
        const rect = el.getBoundingClientRect()
        return (el.textContent ?? '').includes(needle) && rect.width > 0 && rect.right <= innerWidth
      }),
    caseName
  )
  if (!listed) {
    await page.click('[data-testid="app-sidebar-toggle"]')
    await new Promise((resolve) => setTimeout(resolve, 600))
  }
  await clickByText(page, '.v-navigation-drawer .v-list-item', caseName)
  await page.waitForSelector('.variant-type-tabs .v-tab', { visible: true })
  await clickByText(page, '.variant-type-tabs .v-tab', 'SNV/Indel')
  await page.waitForSelector('.v-main tbody tr.v-data-table__tr', { visible: true })
  await idle(page)
}

async function openDetailsPanel(page: Page): Promise<void> {
  const rows = await page.$$('.v-main tbody tr.v-data-table__tr')
  const cells = await rows[1].$$('td')
  await cells[3].click()
  await page.waitForSelector('::-p-text(Variant Details)', { visible: true })
  await idle(page)
}

async function closeDetailsPanel(page: Page): Promise<void> {
  await page.click('::-p-aria(Close variant details)')
  await idle(page)
}

async function switchToCohort(page: Page): Promise<void> {
  await page.click('::-p-aria(Cohort mode)')
  await page.waitForSelector('.v-main tbody tr.v-data-table__tr', { visible: true })
  await idle(page)
}

async function authenticate(browser: Browser, page: Page, state: GateServerState): Promise<void> {
  await browser.setCookie({
    name: state.sessionCookie.name,
    value: state.sessionCookie.value,
    domain: '127.0.0.1',
    path: '/',
    httpOnly: true,
    sameSite: 'Strict'
  })
  await page.evaluateOnNewDocument(
    (key, version) => localStorage.setItem(key, version),
    DISCLAIMER_STORAGE_KEY,
    state.appVersion
  )
}

export async function runLighthouseFlow(
  state: GateServerState,
  preset: LighthousePreset
): Promise<FlowRun> {
  const browser = await puppeteer.launch({
    executablePath: chromium.executablePath(),
    headless: true,
    args: ['--no-first-run', '--no-default-browser-check']
  })
  try {
    const page = await browser.newPage()
    const flow = await startFlow(page, {
      name: `VarLens web UI gate (${preset})`,
      config: preset === 'desktop' ? desktopConfig : undefined,
      flags: { disableStorageReset: true }
    })

    await flow.navigate(`${state.baseURL}/login`, { name: 'login' })
    await authenticate(browser, page, state)
    await flow.navigate(`${state.baseURL}/`, { name: 'home' })
    await idle(page)

    await flow.startTimespan({ name: 'open-case' })
    await openCase(page)
    await flow.endTimespan()
    await flow.snapshot({ name: 'case-table' })

    await flow.startTimespan({ name: 'open-details' })
    await openDetailsPanel(page)
    await flow.endTimespan()
    await flow.snapshot({ name: 'case-details-panel' })

    await closeDetailsPanel(page)
    await flow.startTimespan({ name: 'switch-cohort' })
    await switchToCohort(page)
    await flow.endTimespan()
    await flow.snapshot({ name: 'cohort' })

    const result = await flow.createFlowResult()
    return {
      steps: result.steps.map((step) => ({
        name: step.name,
        lhr: step.lhr as unknown as FlowStepLike['lhr']
      })),
      html: await flow.generateReport()
    }
  } finally {
    await browser.close()
  }
}
