// Track 3 responsive-scaling probe. Usage: node probe.mjs <label> [base]
// Drives a built VarLens web instance through a viewport matrix and records
// row/column visibility, page overflow/scrollability, panel geometry, clipped
// controls and axe serious/critical counts. Writes <label>/results.json + PNGs.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const WT = '/home/bernt-popp/development/VarLens/.claude/worktrees/agent-a43e0d78e72e26023'
const S = '/tmp/claude-1000/-home-bernt-popp-development-VarLens/ec0cfe65-aae3-433f-acb6-d2ba3fcdd209/scratchpad/t3'
const require = createRequire(WT + '/package.json')
const { chromium } = require('playwright')
const AXE = fs.readFileSync(S + '/axe/node_modules/axe-core/axe.min.js', 'utf8')

const [, , label = 'before', BASE = 'http://127.0.0.1:8830', only = ''] = process.argv
const OUT = path.join(S, label)
fs.mkdirSync(OUT, { recursive: true })
const CASE = 'LB26-0060'

const MATRIX = [
  { id: '1366x768', w: 1366, h: 768, dpr: 1 },
  { id: '1280x720', w: 1280, h: 720, dpr: 1 },
  { id: '1920x1080', w: 1920, h: 1080, dpr: 1 },
  { id: '2560x1440', w: 2560, h: 1440, dpr: 1 },
  { id: '320x568', w: 320, h: 568, dpr: 1 },
  { id: 'zoom200-640x400', w: 640, h: 400, dpr: 2 },
  { id: 'text200-1280x800', w: 1280, h: 800, dpr: 1, textScale: 2 }
].filter((m) => only === '' || only.split(',').includes(m.id))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function login(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } })
  const page = await ctx.newPage()
  await page.goto(BASE + '/login')
  await page.fill('#username', 'admin')
  await page.fill('#password', 'varlens-dev-admin')
  await page.click('#submit')
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 })
  const state = await ctx.storageState()
  await ctx.close()
  return state
}

async function idle(page) {
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
  await sleep(500)
}

async function probe(page) {
  return page.evaluate(() => {
    const vw = innerWidth
    const vh = innerHeight
    const main = document.querySelector('.v-main')
    const wrapper = main?.querySelector('.v-table__wrapper')
    const panel = document.querySelector('.v-navigation-drawer--right.v-navigation-drawer--active')
    const out = { vw, vh }
    const se = document.scrollingElement
    out.pageHOverflow = se.scrollWidth > se.clientWidth + 1
    out.pageScrollableY = se.scrollHeight - se.clientHeight
    const region = document.querySelector('.case-content, .cohort-content')
    out.regionScrollableY = region ? region.scrollHeight - region.clientHeight : null
    if (wrapper) {
      const wr = wrapper.getBoundingClientRect()
      const thead = wrapper.querySelector('thead')
      const theadBottom = thead ? thead.getBoundingClientRect().bottom : wr.top
      out.tableViewport = { top: Math.round(wr.top), height: Math.round(wr.height), width: Math.round(wr.width) }
      const rows = [...wrapper.querySelectorAll('tbody tr.v-data-table__tr')]
      out.rowsRendered = rows.length
      // rows fully inside the table's own scroll viewport (reachable by page scroll)
      out.rowsInTable = rows.filter((r) => {
        const b = r.getBoundingClientRect()
        return b.top >= theadBottom - 1 && b.bottom <= wr.bottom + 1
      }).length
      // rows fully visible in the window right now (above the fold)
      out.rowsAboveFold = rows.filter((r) => {
        const b = r.getBoundingClientRect()
        return b.top >= Math.max(theadBottom, 0) - 1 && b.bottom <= Math.min(wr.bottom, vh) + 1
      }).length
      const ths = [...wrapper.querySelectorAll('thead th')]
      out.colsTotal = ths.length
      const visCols = []
      for (const th of ths) {
        const b = th.getBoundingClientRect()
        if (b.width < 2) continue
        if (b.left < wr.left - 1 || b.right > Math.min(wr.right, vw) + 1) continue
        const cx = b.left + b.width / 2
        const cy = Math.min(Math.max(b.top + b.height / 2, 0), vh - 1)
        const hit = document.elementFromPoint(cx, cy)
        if (hit && th.contains(hit)) visCols.push(th.textContent.trim() || '(icon)')
      }
      out.colsVisible = visCols.length
      out.colsVisibleNames = visCols
      out.headerKeys = ths.map((t) => t.textContent.trim())
      // truncated HGVS-like cells and whether they expose the full value
      const tds = [...wrapper.querySelectorAll('tbody td')]
      const trunc = tds.filter((td) => {
        const el = td.querySelector('.hgvs-notation, .transcript-truncated, .text-truncate') || td
        return el.scrollWidth > el.clientWidth + 1
      })
      out.truncatedCells = trunc.length
      out.truncatedWithTitle = trunc.filter((td) => td.querySelector('[title]') || td.title).length
    }
    // footer / pagination occlusion
    const next = main?.querySelector('.v-data-table-footer button[aria-label="Next page"]')
    if (next) {
      const b = next.getBoundingClientRect()
      const cx = b.left + b.width / 2
      const cy = b.top + b.height / 2
      const inView = cx >= 0 && cx < vw && cy >= 0 && cy < vh
      const hit = inView ? document.elementFromPoint(cx, cy) : null
      out.paginationReachable = inView ? !!hit && next.contains(hit) : 'offscreen'
    }
    if (panel) {
      const pb = panel.getBoundingClientRect()
      out.panel = {
        width: Math.round(pb.width),
        docked: !panel.classList.contains('v-navigation-drawer--temporary'),
        overlapsTable: wrapper ? wrapper.getBoundingClientRect().right > pb.left + 1 : null
      }
    }
    // clipped controls (chips/buttons whose content overflows vertically)
    const ctrls = [...document.querySelectorAll('.v-main .v-chip, .v-main .v-btn, .v-app-bar .v-btn')]
    const clipped = ctrls.filter((c) => {
      const r = c.getBoundingClientRect()
      if (r.width === 0) return false
      const content = c.querySelector('.v-chip__content, .v-btn__content') || c
      return content.scrollHeight > r.height + 2
    })
    out.clippedControls = clipped.length
    out.clippedControlLabels = clipped.map((c) => (c.textContent.trim() || c.getAttribute('aria-label') || c.className).slice(0, 40))
    out.sidebar = (() => {
      const d = document.querySelector('nav.v-navigation-drawer--left, .v-navigation-drawer--left')
      if (!d) return null
      return {
        active: d.classList.contains('v-navigation-drawer--active'),
        temporary: d.classList.contains('v-navigation-drawer--temporary')
      }
    })()
    return out
  })
}

async function axe(page) {
  await page.addScriptTag({ content: AXE })
  return page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }
    })
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    return { seriousCritical: bad.length, ids: bad.map((v) => `${v.id}(${v.nodes.length})`), targets: bad.flatMap((v) => v.nodes.map((n) => v.id + " " + n.target.join(" ") + " :: " + (n.any[0]?.message ?? "").slice(0, 120))) }
  })
}

async function scrollPageToBottom(page) {
  await page.evaluate(() => {
    window.scrollTo(0, document.scrollingElement.scrollHeight)
    const region = document.querySelector('.case-content, .cohort-content')
    if (region) region.scrollTop = region.scrollHeight
  })
  await sleep(200)
}

async function ensureSidebarOpen(page) {
  const visible = await page.evaluate((name) => {
    const e = [...document.querySelectorAll('.v-list-item')].find((x) => x.textContent.includes(name))
    if (!e) return false
    const r = e.getBoundingClientRect()
    return r.width > 0 && r.x >= 0 && r.right <= innerWidth
  }, CASE)
  if (!visible) await page.click('[data-testid=app-sidebar-toggle]').catch(() => {})
  await sleep(400)
}

async function runCell(browser, state, m) {
  const ctx = await browser.newContext({
    storageState: state,
    viewport: { width: m.w, height: m.h },
    deviceScaleFactor: m.dpr,
    bypassCSP: true
  })
  await ctx.addInitScript((scale) => {
    try {
      localStorage.setItem('varlens_disclaimer_acknowledged_version', '9.9.9')
    } catch {}
    if (scale) {
      document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.style.fontSize = `${scale * 100}%`
      })
    }
  }, m.textScale ?? 0)
  const page = await ctx.newPage()
  const res = { id: m.id }
  await page.goto(BASE + '/')
  await idle(page)
  // dismiss disclaimer if it still shows
  await page.getByRole('button', { name: /acknowledge|i understand|accept/i }).click({ timeout: 1500 }).catch(() => {})
  res.home = await probe(page)
  await ensureSidebarOpen(page)
  await page.getByText(CASE, { exact: false }).first().click()
  await idle(page)
  await page.getByRole('tab', { name: /SNV/ }).first().click({ timeout: 4000 }).catch(() => {})
  await idle(page)
  await page.waitForSelector('.v-main tbody tr.v-data-table__tr', { timeout: 15000 }).catch(() => {})
  await sleep(400)
  res.caseTable = await probe(page)
  await page.screenshot({ path: path.join(OUT, `${m.id}__case.png`) })
  await scrollPageToBottom(page)
  res.caseTableScrolled = await probe(page)
  await page.screenshot({ path: path.join(OUT, `${m.id}__case-scrolled.png`) })
  res.caseTable.axe = await axe(page)
  await page.evaluate(() => {
    window.scrollTo(0, 0)
    const region = document.querySelector('.case-content, .cohort-content')
    if (region) region.scrollTop = 0
  })
  // open details panel from a row
  const cell = page.locator('.v-main tbody tr.v-data-table__tr td:nth-child(2)').nth(2)
  await cell.scrollIntoViewIfNeeded().catch(() => {})
  await cell.click({ timeout: 5000 }).catch(() => {})
  await sleep(900)
  res.casePanel = await probe(page)
  await page.screenshot({ path: path.join(OUT, `${m.id}__case-panel.png`) })
  await page.keyboard.press('Escape').catch(() => {})
  await page.locator('.v-navigation-drawer--right button[aria-label="Close variant details"]').click({ timeout: 2000 }).catch(() => {})
  await sleep(400)
  // cohort view
  await page.click('[aria-label="Cohort mode"]', { timeout: 4000 }).catch(async () => {
    await page.goto(BASE + '/cohort')
  })
  await idle(page)
  await page.waitForSelector('.v-main tbody tr.v-data-table__tr', { timeout: 15000 }).catch(() => {})
  await sleep(500)
  res.cohort = await probe(page)
  await page.screenshot({ path: path.join(OUT, `${m.id}__cohort.png`) })
  res.cohort.axe = await axe(page)
  await ctx.close()
  return res
}

const browser = await chromium.launch({ headless: true })
const state = await login(browser)
const results = []
for (const m of MATRIX) {
  try {
    const r = await runCell(browser, state, m)
    results.push(r)
    const c = r.caseTable
    process.stdout.write(
      `${m.id}: case rows table/fold ${c.rowsInTable}/${c.rowsAboveFold} cols ${c.colsVisible}/${c.colsTotal} ` +
        `hOverflow ${c.pageHOverflow} scrollY ${c.pageScrollableY}/${c.regionScrollableY} scrolledRowsFold ${r.caseTableScrolled.rowsAboveFold} axe ${c.axe?.seriousCritical} | ` +
        `panel ${JSON.stringify(r.casePanel.panel)} pag ${r.casePanel.paginationReachable} cols ${r.casePanel.colsVisible} | ` +
        `cohort rows ${r.cohort.rowsInTable}/${r.cohort.rowsAboveFold} cols ${r.cohort.colsVisible}/${r.cohort.colsTotal} axe ${r.cohort.axe?.seriousCritical} trunc ${r.cohort.truncatedCells}/${r.cohort.truncatedWithTitle} clipped ${c.clippedControls}\n`
    )
  } catch (e) {
    results.push({ id: m.id, error: String(e) })
    process.stdout.write(`${m.id}: ERROR ${e}\n`)
  }
}
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2))
await browser.close()
