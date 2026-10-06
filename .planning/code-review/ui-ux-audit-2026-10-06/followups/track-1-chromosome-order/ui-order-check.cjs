// Track 1: verify natural chromosome order in the built web UI (case + cohort tables).
const { chromium } = require('/home/bernt-popp/development/VarLens/.claude/worktrees/agent-a33a355046255606a/node_modules/playwright')
const fs = require('fs')
const BASE = 'http://127.0.0.1:8810'
const OUT = process.argv[2] || '/tmp/claude-1000/-home-bernt-popp-development-VarLens/ec0cfe65-aae3-433f-acb6-d2ba3fcdd209/scratchpad/t1-ui'
fs.mkdirSync(OUT, { recursive: true })

async function chrColumn(page) {
  return page.evaluate(() => {
    const table = [...document.querySelectorAll('.v-main table')].find((t) =>
      [...t.querySelectorAll('thead th')].some((th) => /^Chr\b/.test(th.textContent.trim()))
    )
    if (!table) return { headers: [], chr: [] }
    const headers = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim())
    const idx = headers.findIndex((h) => /^Chr\b/.test(h))
    const rows = [...table.querySelectorAll('tbody tr')].filter((tr) => tr.querySelectorAll('td').length > 2)
    return {
      headers,
      chr: rows.map((tr) => (tr.querySelectorAll('td')[idx] || {}).textContent?.trim()),
      pos: rows.map((tr) => (tr.querySelectorAll('td')[idx + 1] || {}).textContent?.trim())
    }
  })
}

async function waitForChrTable(page) {
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.v-main table')].some(
        (t) =>
          [...t.querySelectorAll('thead th')].some((th) => /^Chr\b/.test(th.textContent.trim())) &&
          t.querySelectorAll('tbody tr td').length > 10
      ),
    null,
    { timeout: 20000 }
  )
}

;(async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const page = await ctx.newPage()
  await page.goto(BASE + '/', { waitUntil: 'load' })
  if (await page.locator('#login-form').isVisible().catch(() => false)) {
    await page.fill('#username', 'admin')
    await page.fill('#password', 'varlens-dev-admin')
    await page.click('#submit')
    await page.waitForLoadState('load')
    await page.waitForTimeout(1500)
    if (page.url().includes('login')) await page.goto(BASE + '/', { waitUntil: 'load' })
  }
  await page.waitForSelector('.v-application', { timeout: 20000 })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${OUT}/after-login.png` })
  const ack = page.getByRole('button', { name: /I Understand/ })
  if (await ack.isVisible().catch(() => false)) {
    await ack.click()
    await page.waitForTimeout(800)
  }
  const caseLink = page.getByText('CHRORDER-A').first()
  if (!(await caseLink.isVisible().catch(() => false))) {
    await page.locator('[data-testid=app-sidebar-toggle]').click().catch(() => {})
    await page.waitForTimeout(500)
  }
  await page.getByText('CHRORDER-A').first().click()
  await page.waitForTimeout(2500)
  const shortlist = await page.evaluate(() => {
    const table = [...document.querySelectorAll('.v-main table')].find((t) =>
      [...t.querySelectorAll('thead th')].some((th) => th.textContent.trim() === 'Variant')
    )
    if (!table) return []
    const idx = [...table.querySelectorAll('thead th')].findIndex((th) => th.textContent.trim() === 'Variant')
    return [...table.querySelectorAll('tbody tr')].map((tr) => (tr.querySelectorAll('td')[idx] || {}).textContent?.trim())
  })
  await page.screenshot({ path: `${OUT}/case-shortlist.png` })
  await page.getByRole('tab', { name: /SNV\/Indel/ }).first().click()
  await waitForChrTable(page)
  await page.waitForTimeout(1500)
  const caseDefault = await chrColumn(page)
  await page.screenshot({ path: `${OUT}/case-default.png` })

  const chrHeader = page.locator('.v-main thead th', { hasText: /^Chr/ }).first()
  await chrHeader.click()
  await page.waitForTimeout(1200)
  const caseChrAsc = await chrColumn(page)
  await chrHeader.click()
  await page.waitForTimeout(1200)
  const caseChrDesc = await chrColumn(page)
  await page.screenshot({ path: `${OUT}/case-chr-desc.png` })

  await page.getByRole('tab', { name: /cohort/i }).first().click().catch(async () => {
    await page.getByText(/^Cohort$/).first().click()
  })
  await waitForChrTable(page)
  await page.waitForTimeout(1500)
  const cohortDefault = await chrColumn(page)
  await page.screenshot({ path: `${OUT}/cohort-default.png` })
  const cohortChr = page.locator('.v-main thead th', { hasText: /^Chr/ }).first()
  await cohortChr.click()
  await page.waitForTimeout(1500)
  const cohortChrFirst = await chrColumn(page)
  await page.screenshot({ path: `${OUT}/cohort-chr-click1.png` })
  await cohortChr.click()
  await page.waitForTimeout(1500)
  const cohortChrSecond = await chrColumn(page)
  await page.screenshot({ path: `${OUT}/cohort-chr-click2.png` })

  const result = { shortlist: { chr: shortlist.map((v) => (v || '').split(':')[0]), variants: shortlist }, caseDefault, caseChrAsc, caseChrDesc, cohortDefault, cohortChrFirst, cohortChrSecond }
  fs.writeFileSync(`${OUT}/result.json`, JSON.stringify(result, null, 2))
  for (const [k, v] of Object.entries(result)) console.log(k, JSON.stringify(v.chr))
  await browser.close()
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
