// axe (serious/critical) across key web states in light and dark theme.
// Usage: node axe.mjs <base> <outdir>
import { chromium } from '/home/bernt-popp/development/VarLens/.claude/worktrees/agent-ac57519ac046a3228/node_modules/playwright/index.mjs'
import fs from 'node:fs'
const BASE = process.argv[2] ?? 'http://127.0.0.1:8840'
const OUT = process.argv[3] ?? './axe'
fs.mkdirSync(OUT, { recursive: true })
const AXE = fs.readFileSync('/tmp/claude-1000/-home-bernt-popp-development-VarLens/ec0cfe65-aae3-433f-acb6-d2ba3fcdd209/scratchpad/axe/node_modules/axe-core/axe.min.js', 'utf8')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const summary = {}
for (const theme of ['light', 'dark']) {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme, bypassCSP: true })
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem('varlens_disclaimer_acknowledged_version', '0.73.0')
      localStorage.setItem('varlens_user_settings_v1', JSON.stringify({ themePreference: t }))
    } catch {}
  }, theme)
  const page = await ctx.newPage()
  page.setDefaultTimeout(8000)
  await page.goto(BASE + '/login')
  await page.fill('input[autocomplete=username]', 'admin')
  await page.fill('input[autocomplete=current-password]', 'varlens-dev-admin')
  await page.press('input[autocomplete=current-password]', 'Enter')
  await page.waitForURL((u) => !u.pathname.startsWith('/login'))
  await sleep(2500)
  async function scan(state) {
    await page.addScriptTag({ content: AXE })
    const res = await page.evaluate(async () => {
      // eslint-disable-next-line no-undef
      const r = await axe.run(document, { resultTypes: ['violations'] })
      return r.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes.slice(0, 3).map((n) => n.target.join(' ') + ' :: ' + (n.failureSummary ?? '').split('\n').slice(1, 2).join(' ')) }))
    })
    const key = `${theme}:${state}`
    summary[key] = res
    await page.screenshot({ path: `${OUT}/${theme}-${state}.png` })
    console.log(key, res.length === 0 ? 'OK' : JSON.stringify(res, null, 1))
  }
  await scan('home')
  await page.getByText('T4-HG005').first().click(); await sleep(2500)
  await scan('case-shortlist')
  await page.locator('.variant-type-tabs').getByRole('tab', { name: /SNV/ }).click(); await sleep(2500)
  await scan('case-table')
  await page.locator('.v-main tbody tr.v-data-table__tr td:nth-child(7)').nth(1).click(); await sleep(2500)
  await scan('case-details')
  await page.keyboard.press('Escape'); await sleep(500)
  await page.getByTestId('account-menu').click(); await sleep(500)
  await scan('account-menu')
  await page.getByTestId('open-user-management').click(); await sleep(1500)
  await scan('user-management')
  await page.keyboard.press('Escape'); await sleep(500)
  await page.getByRole('button', { name: 'Cohort mode' }).click(); await sleep(3000)
  await scan('cohort')
  await browser.close()
}
fs.writeFileSync(`${OUT}/axe-summary.json`, JSON.stringify(summary, null, 2))
