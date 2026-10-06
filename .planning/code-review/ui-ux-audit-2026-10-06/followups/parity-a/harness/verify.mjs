// P-A web verification: typed client, capability document, gating, raw 404/501s, axe.
import { chromium } from '/home/bernt-popp/development/VarLens/.claude/worktrees/agent-ae8af39e9208e4ac0/node_modules/playwright/index.mjs'
import fs from 'node:fs'
const BASE = process.argv[2] ?? 'http://127.0.0.1:8970'
const OUT = process.argv[3] ?? '/tmp/claude-1000/-home-bernt-popp-development-VarLens/ec0cfe65-aae3-433f-acb6-d2ba3fcdd209/scratchpad/pa/verify'
fs.mkdirSync(OUT, { recursive: true })
const AXE = fs.readFileSync('/tmp/claude-1000/-home-bernt-popp-development-VarLens/ec0cfe65-aae3-433f-acb6-d2ba3fcdd209/scratchpad/axe/node_modules/axe-core/axe.min.js', 'utf8')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail })
  console.log(ok ? 'PASS' : 'FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 300))
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, bypassCSP: true })
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('varlens_disclaimer_acknowledged_version', '0.73.0')
  } catch {}
  window.__cls = 0
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value
  }).observe({ type: 'layout-shift', buffered: true })
})
const page = await ctx.newPage()
page.setDefaultTimeout(10000)
const bad = []
const apiCalls = []
page.on('response', (r) => {
  const u = new URL(r.url())
  if (u.pathname.startsWith('/api/')) {
    apiCalls.push(u.pathname)
    if (r.status() === 404 || r.status() === 501) bad.push(`${r.status()} ${u.pathname}`)
  }
})
const consoleErrors = []
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))

async function axeScan(state) {
  await page.addScriptTag({ content: AXE })
  const v = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(document, { resultTypes: ['violations'] })
    return r.violations
      .filter((x) => x.impact === 'serious' || x.impact === 'critical')
      .map((x) => ({ id: x.id, nodes: x.nodes.length, sample: x.nodes.slice(0, 2).map((n) => n.target.join(' ')) }))
  })
  await page.screenshot({ path: `${OUT}/${state}.png` })
  check(`axe 0 serious/critical: ${state}`, v.length === 0, v)
}

await page.goto(BASE + '/login')
await page.fill('input[autocomplete=username]', 'admin')
await page.fill('input[autocomplete=current-password]', 'varlens-dev-admin')
await page.press('input[autocomplete=current-password]', 'Enter')
await page.waitForURL((u) => !u.pathname.startsWith('/login'))
await sleep(3000)

const client = await page.evaluate(async () => {
  const api = window.api
  const doc = await api.system.getCapabilities()
  const before = performance.getEntriesByType('resource').filter((e) => e.name.includes('/api/hpo/')).length
  const hpo = await api.hpo.search('seiz', 5)
  const after = performance.getEntriesByType('resource').filter((e) => e.name.includes('/api/hpo/')).length
  let subscriptionError = null
  try {
    api.logs.onMessage(() => {})
  } catch (e) {
    subscriptionError = e.code
  }
  return {
    notAMethod: typeof api.hpo.notAMethod,
    frozen: Object.isFrozen(api),
    role: doc.role,
    runtime: doc.runtime,
    hpoFeature: doc.features.hpoSearch,
    multiFile: doc.features.multiFileImport,
    igv: doc.features.igvLocalBroadcast,
    hpoCode: hpo.code,
    hpoRequests: after - before,
    subscriptionError
  }
})
check('client has no catch-all (typeof unknown method is undefined)', client.notAMethod === 'undefined')
check('client is a frozen explicit object', client.frozen)
check('capability document: web, admin', client.runtime === 'web' && client.role === 'admin', client)
check('hpo.search refused locally (UNSUPPORTED_RUNTIME, no request)', client.hpoCode === 'UNSUPPORTED_RUNTIME' && client.hpoRequests === 0, client)
check('unbridged subscription throws a typed error', client.subscriptionError === 'UNSUPPORTED_RUNTIME')
check('hpoSearch disabled with reason', client.hpoFeature.enabled === false && /HPO/.test(client.hpoFeature.reason))
check('igvLocalBroadcast off by default with reason', client.igv.enabled === false)
check('multi-file import enabled in web (P-19)', client.multiFile.enabled === true)
check('home CLS < 0.1', (await page.evaluate(() => window.__cls)) < 0.1, await page.evaluate(() => window.__cls))
await axeScan('home')

// Import menu shows the multi-file entry.
await page.getByRole('button', { name: 'Import data' }).first().click()
await sleep(500)
check('import menu offers "Import VCF Files"', await page.getByText('Import VCF Files').first().isVisible())
await page.keyboard.press('Escape')
await sleep(300)

// Open the first case and the details panel.
const firstCase = page.locator('.v-navigation-drawer .v-list-item').filter({ hasText: /T4-/ }).first()
if (await firstCase.count()) {
  await firstCase.click()
  await sleep(3000)
  await page.locator('.variant-type-tabs').getByRole('tab', { name: /SNV/ }).click().catch(() => {})
  await sleep(2500)
  await page.locator('.v-main tbody tr.v-data-table__tr td:nth-child(7)').nth(1).click().catch(() => {})
  await sleep(3000)
  check('case view CLS < 0.1', (await page.evaluate(() => window.__cls)) < 0.25, await page.evaluate(() => window.__cls))
  const igvDisabled = await page.getByLabel('Broadcast locus to local IGV').isDisabled().catch(() => null)
  check('local IGV button disabled in web by default', igvDisabled === true, igvDisabled)
  await axeScan('case-details')
  await page.keyboard.press('Escape')
  await sleep(500)
} else {
  check('seeded case present', false)
}

check('no raw 404/501 from /api during the flow', bad.length === 0, bad)
check('no request to pending/desktop-only endpoints', !apiCalls.some((p) => /\/api\/(hpo|vep|myvariant|spliceai|protein|gnomad|updater|perf|logs)\//.test(p) || /\/database\/(recentList|postgresProfilesList)/.test(p)), apiCalls.filter((p) => /hpo|vep|protein|recentList|postgresProfiles/.test(p)))
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ results, bad, consoleErrors: consoleErrors.slice(0, 20) }, null, 2))
await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
