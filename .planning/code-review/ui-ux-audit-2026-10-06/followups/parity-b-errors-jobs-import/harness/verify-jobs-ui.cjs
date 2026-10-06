// Headless verification of the background-jobs panel in the built web app
// (port 8980): a long case_delete job shows progress in case and cohort views,
// is announced via aria-live, the Cancel button is keyboard reachable and works,
// and axe reports 0 serious/critical violations with the panel open.
const { chromium } = require('/home/bernt-popp/development/VarLens/.claude/worktrees/agent-ae56b7a2140aa9582/node_modules/playwright')
const AXE = require.resolve('/home/bernt-popp/development/VarLens/.claude/worktrees/agent-ae56b7a2140aa9582/node_modules/axe-core/axe.min.js')
const fs = require('fs')

const BASE = 'http://127.0.0.1:8980'
const OUT = process.argv[2]
const PASSWORD = process.env.VERIFY_PASSWORD
const caseIds = JSON.parse(process.env.VERIFY_CASE_IDS)

async function axe(page, label, results) {
  await page.addScriptTag({ path: AXE })
  const res = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(document, { resultTypes: ['violations'] })
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }))
  })
  results.axe[label] = res
  return res.filter((v) => v.impact === 'serious' || v.impact === 'critical')
}

;(async () => {
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, bypassCSP: true })
  const page = await context.newPage()
  const results = { axe: {}, checks: {} }

  await page.goto(`${BASE}/login`)
  await page.fill('input[name="username"], input[autocomplete="username"]', 'admin')
  await page.fill('input[type="password"]', PASSWORD)
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }), page.keyboard.press('Enter')])
  await page.goto(`${BASE}/case`)
  await page.waitForLoadState('networkidle')
  const ack = page.getByRole('button', { name: /I Understand/ })
  if (await ack.isVisible().catch(() => false)) await ack.click()

  // Start a long delete through the same API the UI uses.
  const started = await page.evaluate(async (ids) => {
    const res = await fetch('/api/cases/startDelete', {
      method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ args: [{ mode: 'ids', ids }] })
    })
    return { status: res.status, body: await res.json() }
  }, caseIds)
  results.checks.startDelete = started

  const item = page.locator('[data-testid="background-job-case_delete"]')
  await item.waitFor({ timeout: 15000 })
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="background-job-case_delete"] [role="progressbar"]')
    return el && el.getAttribute('aria-valuenow') !== null
  }, null, { timeout: 15000 }).catch(() => undefined)
  results.checks.caseViewText = await item.innerText()
  results.checks.progressbar = await item.locator('[role="progressbar"]').evaluate((el) => ({
    label: el.getAttribute('aria-label'), now: el.getAttribute('aria-valuenow')
  }))
  results.checks.liveRegion = await page.locator('[data-testid="background-jobs"] [aria-live="polite"]').innerText()
  await page.screenshot({ path: `${OUT}/jobs-panel-case-view.png` })
  results.seriousCase = await axe(page, 'case-view-with-panel', results)

  // Cohort view: same panel.
  await page.goto(`${BASE}/cohort`)
  await page.waitForLoadState('networkidle')
  const cohortItem = page.locator('[data-testid="background-job-case_delete"]')
  results.checks.visibleInCohort = await cohortItem.isVisible().catch(() => false)
  await page.screenshot({ path: `${OUT}/jobs-panel-cohort-view.png` })
  results.seriousCohort = await axe(page, 'cohort-view-with-panel', results)

  // Keyboard: focus the Cancel button by tabbing, then press Enter.
  const cancel = page.getByRole('button', { name: 'Cancel Deleting cases' })
  let reached = false
  for (let i = 0; i < 1500 && !reached; i++) {
    await page.keyboard.press('Tab')
    reached = await cancel.evaluate((el) => el === document.activeElement).catch(() => false)
  }
  results.checks.cancelReachableByTab = reached
  if (reached) await page.keyboard.press('Enter')
  else await cancel.click()
  await page.waitForFunction(() => /Cancelled|Completed/.test(document.querySelector('[data-testid="background-jobs"]')?.textContent ?? ''), null, { timeout: 120000 }).catch(() => undefined)
  results.checks.afterCancelText = await page.locator('[data-testid="background-jobs"]').innerText()
  await page.screenshot({ path: `${OUT}/jobs-panel-cancelled.png` })

  // Mobile width: panel fits without horizontal scroll.
  await page.setViewportSize({ width: 390, height: 844 })
  results.checks.mobileNoHScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

  fs.writeFileSync(`${OUT}/jobs-ui-verification.json`, JSON.stringify(results, null, 2))
  console.log(JSON.stringify({ checks: results.checks, seriousCase: results.seriousCase, seriousCohort: results.seriousCohort }, null, 2))
  await browser.close()
})().catch((err) => { console.error(err); process.exit(1) })
