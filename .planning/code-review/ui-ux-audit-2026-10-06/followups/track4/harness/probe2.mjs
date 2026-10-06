// Deeper settings/admin probes. Usage: node probe2.mjs <base> <outdir>
import { chromium } from '/home/bernt-popp/development/VarLens/.claude/worktrees/agent-ac57519ac046a3228/node_modules/playwright/index.mjs'
import fs from 'node:fs'
const BASE = process.argv[2] ?? 'http://127.0.0.1:8840'
const OUT = process.argv[3] ?? './probe2'
fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(() => { try { localStorage.setItem('varlens_disclaimer_acknowledged_version', '0.73.0') } catch {} })
const page = await ctx.newPage()
page.setDefaultTimeout(6000)
let events = []
page.on('console', (m) => { if (m.type() === 'error') events.push(`console.error: ${m.text().slice(0, 200)}`) })
page.on('pageerror', (e) => events.push(`pageerror: ${e.message.slice(0, 200)}`))
page.on('response', (r) => { if (r.status() >= 400) events.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`) })
const apiCalls = []
page.on('request', (r) => { const p = new URL(r.url()).pathname; if (p.startsWith('/api/')) apiCalls.push(p) })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await page.goto(BASE + '/login')
await page.fill('input[autocomplete=username]', 'admin')
await page.fill('input[autocomplete=current-password]', 'varlens-dev-admin')
await page.press('input[autocomplete=current-password]', 'Enter')
await page.waitForURL((u) => !u.pathname.startsWith('/login'))
await sleep(2000)
{ const c = page.getByRole('button', { name: /I Understand/i }); if (await c.count()) { await c.click(); await sleep(500) } }
await sleep(2500)
const results = []
async function step(name, fn) {
  events = []; apiCalls.length = 0
  let note = ''
  try { note = (await fn()) ?? '' } catch (e) { note = 'ERROR ' + e.message.split('\n')[0].slice(0, 160) }
  await sleep(700)
  await page.screenshot({ path: `${OUT}/${name.replace(/\W+/g, '_')}.png` })
  results.push({ name, note, events: [...new Set(events)], api: [...new Set(apiCalls)] })
  console.error('done', name)
}
async function closeAll() { await page.reload(); await sleep(2500) }
async function openSettings(title) {
  await closeAll()
  await page.getByTestId('app-settings-menu').click(); await sleep(250)
  await page.locator('.v-overlay--active .v-list-item').filter({ hasText: title }).first().click(); await sleep(900)
}
const top = () => page.locator('.v-overlay--active .v-card').last()
await step('tags: create tag', async () => {
  await openSettings('Custom Tags')
  await top().getByRole('button', { name: /add tag/i }).first().click(); await sleep(300)
  await top().getByLabel(/tag name/i).fill('T4 probe tag')
  await top().getByRole('button', { name: /^save$/i }).click(); await sleep(900)
  return (await top().innerText()).includes('T4 probe tag') ? 'created and listed' : 'NOT listed after save'
})
await step('external links: toggle + reload persists', async () => {
  await openSettings('External Links')
  const sw = top().locator('input[type=checkbox]').first()
  const before = await sw.isChecked()
  await sw.click({ force: true }); await sleep(800)
  await page.reload(); await sleep(2500)
  await openSettings('External Links')
  const after = await top().locator('input[type=checkbox]').first().isChecked()
  await top().locator('input[type=checkbox]').first().click({ force: true }); await sleep(600) // restore
  return `before=${before} afterReload=${after} ${before !== after ? 'persisted' : 'NOT persisted'}`
})
await step('gene panels: open', async () => { await openSettings('Gene Panels'); return (await top().innerText()).slice(0, 160) })
await step('gene panels: new panel + gene autocomplete', async () => {
  await top().getByRole('button', { name: /new panel/i }).click(); await sleep(700)
  await top().getByLabel(/panel name/i).fill('T4 panel')
  const search = top().getByPlaceholder(/search gene symbol/i)
  await search.click(); await search.pressSequentially('BRCA', { delay: 60 }); await sleep(1500)
  const opts = await page.locator('.v-overlay--active .v-list-item').allInnerTexts()
  return 'autocomplete options: ' + opts.slice(0, 5).join(' ; ').replace(/\n/g, ' ')
})
await step('gene panels: paste list validate', async () => {
  await page.keyboard.press('Escape')
  await top().getByRole('button', { name: /paste list/i }).click(); await sleep(500)
  await page.locator('.v-overlay--active textarea').last().fill('BRCA1\nTP53\nNOTAGENE')
  const btn = page.locator('.v-overlay--active').last().getByRole('button', { name: /add|validate|import|ok/i }).last()
  await btn.click(); await sleep(1500)
  return (await top().innerText()).replace(/\n/g, ' / ').slice(0, 300)
})
await step('gene panels: save new panel', async () => {
  await top().getByRole('button', { name: /^save$/i }).click(); await sleep(1200)
  return (await page.locator('.v-overlay--active').last().innerText()).replace(/\n/g, ' / ').slice(0, 300)
})
await step('gene panels: PanelApp search', async () => {
  await openSettings('Gene Panels')
  await top().getByRole('button', { name: /import panelapp/i }).click(); await sleep(700)
  const inp = top().locator('input').first()
  await inp.fill('epilepsy'); await page.keyboard.press('Enter'); await sleep(2000)
  return (await top().innerText()).replace(/\n/g, ' / ').slice(0, 300)
})
await step('gene panels: StringDB', async () => {
  await openSettings('Gene Panels')
  await top().getByRole('button', { name: /stringdb/i }).click(); await sleep(700)
  return (await top().innerText()).replace(/\n/g, ' / ').slice(0, 300)
})
await step('import: options', async () => { await closeAll(); await page.keyboard.press('Control+i'); await sleep(900); return (await top().innerText()).replace(/\n/g, ' / ').slice(0, 300) })
await step('delete all cases', async () => { await openSettings('Delete All Cases'); return (await page.locator('.v-overlay--active').last().innerText()).replace(/\n/g, ' / ').slice(0, 200) })
await step('reset columns', async () => { await openSettings('Reset Columns'); return 'clicked' })
await step('reset filters', async () => { await openSettings('Reset Filters'); return 'clicked' })
await step('footer buttons', async () => {
  await closeAll()
  const labels = await page.locator('footer button, footer a').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') || e.textContent.trim()))
  return labels.join(' | ')
})
for (const label of ['Log', 'FAQ', 'Disclaimer', 'Keyboard']) {
  await step('footer: ' + label, async () => {
    await closeAll()
    const b = page.locator('footer').locator(`button[aria-label*="${label}" i], button:has-text("${label}")`).first()
    await b.click(); await sleep(1000)
    return (await page.locator('.v-overlay--active').last().innerText()).replace(/\n/g, ' / ').slice(0, 160)
  })
}
await step('case: open + case metadata dialog', async () => {
  await closeAll()
  await page.getByText('T4-HG005').first().click(); await sleep(2500)
  await page.getByRole('button', { name: 'Case details' }).click(); await sleep(1500)
  return (await top().innerText()).replace(/\n/g, ' / ').slice(0, 300)
})
await step('case metadata: tabs', async () => {
  const tabs = await top().getByRole('tab').allInnerTexts()
  let out = 'tabs=' + tabs.join(',')
  for (const t of tabs) { await top().getByRole('tab', { name: t }).click(); await sleep(900); out += ` || ${t}: ` + (await top().innerText()).replace(/\n/g, ' / ').slice(0, 120) }
  return out
})
await step('database overview', async () => { await openSettings('Database Overview'); await sleep(800); return (await top().innerText()).replace(/\n/g, ' / ').slice(0, 200) })
const uname = 't4u' + (Date.now() % 100000)
const um = () => page.locator('.v-overlay--active').filter({ hasText: 'User Management' }).last()
await step('account menu: identity', async () => {
  await closeAll()
  await page.getByTestId('account-menu').click(); await sleep(400)
  return (await page.locator('.v-overlay--active').last().innerText()).replace(/\n/g, ' / ')
})
await step('admin: open user management', async () => {
  await page.getByTestId('open-user-management').click(); await sleep(1500)
  return (await um().innerText()).replace(/\n/g, ' / ').slice(0, 300)
})
await step('admin: create user', async () => {
  await um().getByRole('button', { name: /add user/i }).click(); await sleep(400)
  const d = page.locator('.v-overlay--active').last()
  await d.getByLabel('Username').fill(uname)
  await d.getByLabel('Display Name').fill('T4 Probe')
  await d.getByLabel('Temporary Password').fill('Temp-Password-123')
  await d.getByRole('button', { name: /create user/i }).click(); await sleep(1500)
  return (await um().innerText()).includes(uname) ? 'created + listed' : 'NOT listed'
})
await step('admin: change role', async () => {
  const row = page.getByTestId(`user-row-${uname}`)
  await row.locator('.v-select').click(); await sleep(300)
  await page.locator('.v-overlay--active .v-list-item').filter({ hasText: 'Admin' }).last().click(); await sleep(1200)
  const roleNow = await row.locator('.v-select').innerText()
  await row.locator('.v-select').click(); await sleep(300)
  await page.locator('.v-overlay--active .v-list-item').filter({ hasText: /^User$/ }).last().click(); await sleep(1200)
  return 'after promote: ' + roleNow.trim() + ' | after demote: ' + (await row.locator('.v-select').innerText()).trim()
})
await step('admin: reset password', async () => {
  await page.getByRole('button', { name: `Reset password for ${uname}` }).click(); await sleep(400)
  const d = page.locator('.v-overlay--active').last()
  await d.getByLabel(/new temporary password/i).fill('Other-Password-456')
  await d.getByRole('button', { name: /reset password/i }).click(); await sleep(1200)
  return (await um().locator('.v-alert').allInnerTexts()).join(' | ')
})
await step('admin: disable user', async () => {
  await page.getByRole('button', { name: `Disable ${uname}` }).click(); await sleep(400)
  await page.getByTestId('confirm-toggle-active').click(); await sleep(1200)
  return (await page.getByTestId(`user-row-${uname}`).innerText()).replace(/\s+/g, ' ')
})
await step('admin: re-enable user', async () => {
  await page.getByRole('button', { name: `Re-enable ${uname}` }).click(); await sleep(400)
  await page.getByTestId('confirm-toggle-active').click(); await sleep(1200)
  return (await page.getByTestId(`user-row-${uname}`).innerText()).replace(/\s+/g, ' ')
})
await step('account: sign out', async () => {
  await closeAll()
  await page.getByTestId('account-menu').click(); await sleep(400)
  await page.getByTestId('sign-out').click(); await sleep(2000)
  const after = page.url()
  const r = await page.evaluate(async () => (await fetch('/api/auth/currentUser', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: '{"args":[]}' })).status)
  return `url=${new URL(after).pathname} currentUser status=${r}`
})
fs.writeFileSync(`${OUT}/probe2.json`, JSON.stringify(results, null, 2))
for (const r of results) { console.log(`## ${r.name}: ${r.note}`); for (const e of r.events) console.log('   - ' + e); console.log('   api: ' + r.api.join(' ')) }
await browser.close()
