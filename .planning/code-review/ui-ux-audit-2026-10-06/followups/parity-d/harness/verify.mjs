// P-D web verification: viewer / analyst / admin in a built web instance.
// Usage: node verify.mjs <base-url> <out-dir> <worktree>
// Seeds expected (harness/seed.mjs): admin, ana (analyst), vic (viewer), one case.
import fs from 'node:fs'
import { createRequire } from 'node:module'

const BASE = process.argv[2] ?? 'http://127.0.0.1:9000'
const OUT = process.argv[3] ?? '/tmp/parity-d-verify'
const ROOT = process.argv[4] ?? process.cwd()
const require = createRequire(`${ROOT}/package.json`)
const { chromium } = require('playwright')
const XLSX = require('xlsx')
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')
fs.mkdirSync(OUT, { recursive: true })

const USERS = {
  viewer: ['vic', 'vic-final-password-2'],
  analyst: ['ana', 'ana-final-password-1'],
  admin: ['admin', 'varlens-dev-admin']
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail })
  console.log(ok ? 'PASS' : 'FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 300))
}

const browser = await chromium.launch()

async function axeScan(page, state) {
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

async function session(role) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, bypassCSP: true })
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('varlens_disclaimer_acknowledged_version', '0.73.0')
    } catch {}
  })
  const page = await ctx.newPage()
  page.setDefaultTimeout(10000)
  const [username, password] = USERS[role]
  await page.goto(BASE + '/login')
  await page.fill('input[autocomplete=username]', username)
  await page.fill('input[autocomplete=current-password]', password)
  await page.press('input[autocomplete=current-password]', 'Enter')
  await page.waitForURL((u) => !u.pathname.startsWith('/login'))
  await sleep(2500)
  return { ctx, page }
}

async function openCase(page) {
  await page.locator('.v-navigation-drawer .v-list-item').filter({ hasText: /Parity D Case/ }).first().click()
  await sleep(2500)
}

async function openSnvTab(page) {
  await page.getByRole('tab', { name: /SNV/ }).first().click()
  await sleep(2500)
}

for (const role of ['viewer', 'analyst', 'admin']) {
  const { ctx, page } = await session(role)
  const doc = await page.evaluate(() => window.api.system.getCapabilities())
  check(`${role}: capability document role`, doc.role === role, doc.role)

  const chip = await page.getByTestId('read-only-chip').count()
  check(`${role}: read-only chip ${role === 'viewer' ? 'shown' : 'absent'}`, (chip > 0) === (role === 'viewer'))
  const importButtons = await page.getByRole('button', { name: 'Import data' }).count()
  check(`${role}: sidebar import ${role === 'viewer' ? 'hidden' : 'offered'}`, (importButtons > 0) === (role !== 'viewer'), importButtons)
  await axeScan(page, `${role}-home`)

  await openCase(page)
  const shortlistStar = page.locator('[data-testid^="shortlist-star-"]').first()
  const shortlistDisabled = await shortlistStar.isDisabled().catch(() => null)
  check(`${role}: shortlist star ${role === 'viewer' ? 'disabled' : 'enabled'}`, shortlistDisabled === (role === 'viewer'), shortlistDisabled)
  await openSnvTab(page)
  const star = page.locator('button.annotation-btn[aria-pressed]').first()
  const starDisabled = await star.isDisabled().catch(() => null)
  check(`${role}: variant-table star ${role === 'viewer' ? 'disabled' : 'enabled'}`, starDisabled === (role === 'viewer'), starDisabled)

  // Export: viewers get a disabled button; others a CSV / Excel menu with real downloads.
  await axeScan(page, `${role}-case`)
  // Below the widest layout tier the toolbar folds Export into "More actions".
  const exportMenu = page.getByTestId('export-menu')
  const openExport = async () => {
    if ((await exportMenu.count()) > 0) await exportMenu.click()
    else await page.getByRole('button', { name: 'More actions' }).click()
    await sleep(300)
  }
  if (role === 'viewer') {
    check('viewer: export menu not offered', (await exportMenu.count()) === 0)
    // Wide layout: a disabled Export button; narrow: a disabled overflow item.
    const exportButton = page.getByRole('button', { name: 'Export', exact: true })
    let exportDisabled = null
    if ((await exportButton.count()) > 0) {
      exportDisabled = await exportButton.first().isDisabled()
    } else {
      await page.getByRole('button', { name: 'More actions' }).click()
      await sleep(300)
      const item = page.locator('.v-overlay--active .v-list-item').filter({ hasText: 'Export' }).first()
      exportDisabled = (await item.getAttribute('class'))?.includes('v-list-item--disabled') ?? null
    }
    const csvOffered = await page.getByTestId('export-csv').count()
    check('viewer: export disabled and no CSV/Excel choice', exportDisabled === true && csvOffered === 0, { exportDisabled, csvOffered })
    await page.keyboard.press('Escape')
    const refused = await page.evaluate(() =>
      window.api.export.variants(1, {}, 'Parity D Case', { format: 'csv' })
    )
    check('viewer: export refused (403 role-required, no download)', refused?.message === 'role-required', refused)
    const bypass = await page.evaluate(async () => {
      const r = await fetch('/api/tags/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ args: [{ name: 'x', color: '#fff' }] })
      })
      return { status: r.status, body: await r.json() }
    })
    check('viewer: raw HTTP write bypassing the client is 403 role-required', bypass.status === 403 && bypass.body.details?.error === 'role-required', bypass)
  } else {
    for (const format of ['csv', 'xlsx']) {
      await openExport()
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }),
        page.getByTestId(`export-${format}`).click()
      ])
      const path = `${OUT}/${role}-variants.${format}`
      await download.saveAs(path)
      const name = download.suggestedFilename()
      if (format === 'csv') {
        const lines = fs.readFileSync(path, 'utf8').trim().split('\r\n')
        check(`${role}: CSV download ${name}`, name.endsWith('_variants.csv') && lines[0].startsWith('Chromosome') && lines.length > 1, { name, rows: lines.length - 1 })
      } else {
        const wb = XLSX.readFile(path)
        const rows = XLSX.utils.sheet_to_json(wb.Sheets.Variants, { header: 1 })
        check(`${role}: XLSX download ${name}`, name.endsWith('.xlsx') && wb.SheetNames.includes('Export Info') && rows.length > 1, { name, sheets: wb.SheetNames, rows: rows.length - 1 })
      }
      await sleep(500)
    }
    const replay = await page.evaluate(async () => {
      const p = await fetch('/api/export/prepareDownload', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ args: [{ kind: 'cohort', params: {} }] })
      }).then((r) => r.json())
      const first = await fetch(`/api/${p.downloadPath}`)
      await first.arrayBuffer()
      const second = await fetch(`/api/${p.downloadPath}`)
      return { first: first.status, second: second.status }
    })
    check(`${role}: download link is single-use`, replay.first === 200 && replay.second === 404, replay)
  }

  // Settings menu: Delete All Cases is admin-only.
  await page.getByTestId('app-settings-menu').click()
  await sleep(400)
  const deleteAll = await page.locator('.v-list-item').filter({ hasText: 'Delete All Cases' }).count()
  const importItem = await page.locator('.v-list-item').filter({ hasText: 'Import Data' }).count()
  check(`${role}: Delete All Cases ${role === 'admin' ? 'offered' : 'hidden'}`, (deleteAll > 0) === (role === 'admin'), deleteAll)
  check(`${role}: Import Data ${role === 'viewer' ? 'hidden' : 'offered'}`, (importItem > 0) === (role !== 'viewer'), importItem)
  await axeScan(page, `${role}-settings-menu`)
  await page.keyboard.press('Escape')
  await ctx.close()
}

fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2))
await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
