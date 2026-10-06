// Gene panel create + tag create in web. Usage: node panel.mjs <base> <outdir>
import { chromium } from '/home/bernt-popp/development/VarLens/.claude/worktrees/agent-ac57519ac046a3228/node_modules/playwright/index.mjs'
import fs from 'node:fs'
const BASE = process.argv[2] ?? 'http://127.0.0.1:8840'
const OUT = process.argv[3] ?? './panel'
fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(() => { try { localStorage.setItem('varlens_disclaimer_acknowledged_version', '0.73.0') } catch {} })
const page = await ctx.newPage()
page.setDefaultTimeout(8000)
const events = []
page.on('response', (r) => { if (r.url().includes('/api/')) events.push(`${r.status()} ${new URL(r.url()).pathname}`) })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const check = (n, c, x = '') => console.log(`${c ? 'PASS' : 'FAIL'} ${n} ${x}`)
await page.goto(BASE + '/login')
await page.fill('input[autocomplete=username]', 'admin')
await page.fill('input[autocomplete=current-password]', 'varlens-dev-admin')
await page.press('input[autocomplete=current-password]', 'Enter')
await page.waitForURL((u) => !u.pathname.startsWith('/login'))
await sleep(2500)
async function openSettings(title) {
  await page.getByTestId('app-settings-menu').click(); await sleep(300)
  await page.locator('.v-overlay--active .v-list-item').filter({ hasText: title }).first().click(); await sleep(1000)
}
// Gene panel
await openSettings('Gene Panels')
await page.getByRole('button', { name: /new panel/i }).click(); await sleep(700)
const dlg = page.locator('.v-card').filter({ hasText: 'Create Panel' }).last()
const name = 'T4 panel ' + (Date.now() % 10000)
await dlg.getByLabel(/panel name/i).fill(name)
const search = dlg.getByPlaceholder(/search gene symbol/i)
await search.click(); await search.pressSequentially('BRCA1', { delay: 50 }); await sleep(1500)
await page.locator('.v-overlay--active .v-list-item').filter({ hasText: 'BRCA1 DNA repair' }).first().click(); await sleep(800)
await page.screenshot({ path: `${OUT}/panel-editor.png` })
const saveBtn = dlg.getByRole('button', { name: /^Save$/ })
check('save enabled after adding a gene', await saveBtn.isEnabled())
events.length = 0
await saveBtn.click(); await sleep(1500)
const listText = await page.locator('.v-card').filter({ hasText: 'Gene Panels' }).last().innerText()
check('panel created and listed', listText.includes(name), events.join(', '))
await page.screenshot({ path: `${OUT}/panel-list.png` })
await page.reload(); await sleep(2500)
// Tag
await openSettings('Custom Tags')
const tagDlg = page.locator('.v-overlay--active').last()
await tagDlg.getByRole('button', { name: /add tag/i }).first().click(); await sleep(400)
const tag = 'T4 tag ' + (Date.now() % 10000)
await page.locator('.v-overlay--active').last().getByLabel(/tag name/i).fill(tag)
events.length = 0
await page.locator('.v-overlay--active').last().getByRole('button', { name: /^save$/i }).click(); await sleep(1200)
check('tag created and listed', (await page.locator('.v-overlay--active').last().innerText()).includes(tag), events.join(', '))
await browser.close()
