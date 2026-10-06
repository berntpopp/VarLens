// URL state verification in the built web instance. Usage: node urlstate.mjs <base> <outdir>
import { chromium } from '/home/bernt-popp/development/VarLens/.claude/worktrees/agent-ac57519ac046a3228/node_modules/playwright/index.mjs'
import fs from 'node:fs'
const BASE = process.argv[2] ?? 'http://127.0.0.1:8840'
const OUT = process.argv[3] ?? './urlstate'
fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(() => { try { localStorage.setItem('varlens_disclaimer_acknowledged_version', '0.73.0') } catch {} })
const page = await ctx.newPage()
page.setDefaultTimeout(8000)
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 200)))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)) })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = []
const q = () => Object.fromEntries(new URL(page.url()).searchParams)
const check = (name, cond, extra = '') => { log.push(`${cond ? 'PASS' : 'FAIL'} ${name} ${extra}`); console.log(log.at(-1)) }

await page.goto(BASE + '/login')
await page.fill('input[autocomplete=username]', 'admin')
await page.fill('input[autocomplete=current-password]', 'varlens-dev-admin')
await page.press('input[autocomplete=current-password]', 'Enter')
await page.waitForURL((u) => !u.pathname.startsWith('/login'))
await sleep(2500)

// 1. open case → ?case=
await page.getByText('T4-HG005').first().click(); await sleep(2500)
check('case selection writes ?case', q().case !== undefined, JSON.stringify(q()))
const caseA = q().case
// 2. switch to SNV/Indel tab → ?tab=snv
await page.locator('.variant-type-tabs').getByRole('tab', { name: /SNV/ }).click(); await sleep(2000)
check('tab writes ?tab=snv', q().tab === 'snv', JSON.stringify(q()))
// 3. sort by Gene header → ?sort=
const geneTh = page.locator('.v-main thead th').filter({ hasText: /^Gene/ }).first()
await geneTh.click(); await sleep(1500)
check('sort writes ?sort', typeof q().sort === 'string', JSON.stringify(q()))
// 4. quick filter chip / search
const search = page.locator('.v-main input[placeholder^="Gene, chr:pos"]').first()
await search.click(); await search.fill('TTN'); await page.keyboard.press('Enter'); await sleep(1500)
check('search writes ?q', q().q === 'TTN', JSON.stringify(q()))
const before = q()
await page.screenshot({ path: `${OUT}/1-before-reload.png` })
// 5. reload restores
await page.reload(); await sleep(4000)
const after = q()
check('reload keeps the URL', JSON.stringify(after) === JSON.stringify(before), JSON.stringify(after))
const activeTab = await page.locator('.variant-type-tabs .v-tab--selected').innerText().catch(() => '')
check('reload restores tab', /SNV/.test(activeTab), activeTab)
const searchVal = await page.locator('.v-main input[placeholder^="Gene, chr:pos"]').first().inputValue().catch(() => '')
check('reload restores search text', searchVal === 'TTN', searchVal)
const sortedTh = await page.locator('.v-main thead th[aria-sort]:not([aria-sort="none"])').allInnerTexts().catch(() => [])
check('reload restores sort header state', sortedTh.some((t) => /Gene/.test(t)), JSON.stringify(sortedTh))
const caseLabel = await page.locator('header .context-label').innerText().catch(() => '')
check('reload restores case', /T4-HG005/.test(caseLabel), caseLabel)
await page.screenshot({ path: `${OUT}/2-after-reload.png` })
// 6. another case then back
await page.getByText('T4-HG006').first().click(); await sleep(2500)
check('case switch pushes new case', q().case !== caseA, JSON.stringify(q()))
await page.goBack(); await sleep(3000)
const backLabel = await page.locator('header .context-label').innerText().catch(() => '')
check('back returns to previous case', q().case === caseA && /T4-HG005/.test(backLabel), JSON.stringify(q()) + ' ' + backLabel)
await page.goForward(); await sleep(3000)
const fwdLabel = await page.locator('header .context-label').innerText().catch(() => '')
check('forward returns to next case', /T4-HG006/.test(fwdLabel), fwdLabel)
// 7a. case -> cohort -> case keeps the case URL state
const caseQ = q()
await page.getByRole('button', { name: 'Cohort mode' }).click(); await sleep(2500)
await page.getByRole('button', { name: 'Case mode' }).click(); await sleep(2500)
check('case view keeps its URL state after cohort round-trip', q().case === caseQ.case && q().tab === caseQ.tab, JSON.stringify(q()))
// 7. cohort parity
await page.getByRole('button', { name: 'Cohort mode' }).click(); await sleep(3000)
check('cohort route', new URL(page.url()).pathname === '/cohort', page.url())
const cth = page.locator('.v-main thead th').filter({ hasText: /^Gene/ }).first()
await cth.click(); await sleep(1500)
const csearch = page.locator('.v-main input[placeholder^="Gene, chr:pos"]').first()
if (await csearch.count()) { await csearch.click(); await csearch.fill('MAPK1'); await page.keyboard.press('Enter'); await sleep(1500) }
const cq = q()
check('cohort writes sort/q', typeof cq.sort === 'string' && cq.q === 'MAPK1', JSON.stringify(cq))
await page.reload(); await sleep(4000)
check('cohort reload keeps URL', JSON.stringify(q()) === JSON.stringify(cq), JSON.stringify(q()))
const cSearchVal = await page.locator('.v-main input[placeholder^="Gene, chr:pos"]').first().inputValue().catch(() => '')
check('cohort reload restores search', cSearchVal === 'MAPK1', cSearchVal)
await page.screenshot({ path: `${OUT}/3-cohort-after-reload.png` })
// 9. quick filters -> ?f= (cohort view) and restore
await page.getByText('HIGH Impact', { exact: true }).first().click(); await sleep(1500)
const fq = q()
check('quick filter writes ?f', typeof fq.f === 'string', JSON.stringify(fq))
const countBefore = await page.locator('.v-main .count-pill, .v-main [data-testid="filter-count"]').first().innerText().catch(() => '')
await page.reload(); await sleep(4000)
check('reload keeps ?f', q().f === fq.f, JSON.stringify(q()))
const chips = await page.locator('.v-main').getByText(/HIGH/).allInnerTexts()
check('reload restores the filter chip', chips.some((t) => /Impact|HIGH/.test(t)), JSON.stringify(chips.slice(0, 6)) + ' ' + countBefore)
await page.screenshot({ path: `${OUT}/4-filters-after-reload.png` })
fs.writeFileSync(`${OUT}/urlstate.json`, JSON.stringify({ log, errors: [...new Set(errors)] }, null, 2))
console.log('errors:', [...new Set(errors)].join('\n'))
await browser.close()
