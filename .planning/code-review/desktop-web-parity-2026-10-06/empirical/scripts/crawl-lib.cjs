// Shared crawl harness: event capture per step, screenshots, result recording.
const fs = require('fs')
const path = require('path')
const { chromium } = require('/home/bernt-popp/development/VarLens/.claude/worktrees/agent-a441a5be6bf38012d/node_modules/playwright')

const BASE = 'http://127.0.0.1:8900'
const OUT = __dirname
const SCREENS = path.join(OUT, 'screens')
fs.mkdirSync(SCREENS, { recursive: true })

class NotFound extends Error {}
const notFound = (msg) => {
  throw new NotFound(msg)
}

function createHarness() {
  const results = []
  let cur = null
  const apiLog = []
  const pending = []

  function bucket() {
    return cur ?? { name: '(between-steps)', consoleErrors: [], consoleWarnings: [], pageErrors: [], failedRequests: [], apiCalls: [], popups: [] }
  }

  function attach(page) {
    page.on('console', (msg) => {
      const t = msg.type()
      if (t === 'error') bucket().consoleErrors.push(msg.text().slice(0, 600))
      else if (t === 'warning') bucket().consoleWarnings.push(msg.text().slice(0, 400))
    })
    page.on('pageerror', (err) => bucket().pageErrors.push(String(err && err.message ? err.message : err).slice(0, 600)))
    page.on('requestfailed', (req) => {
      const f = req.failure()
      bucket().failedRequests.push({ method: req.method(), url: req.url(), status: null, failure: f ? f.errorText : 'failed' })
    })
    page.on('response', (res) => {
      const url = res.url()
      const status = res.status()
      const b = bucket()
      if (url.includes('/api/')) {
        const entry = { method: res.request().method(), path: url.replace(BASE, ''), status }
        b.apiCalls.push(entry)
        apiLog.push({ step: b.name, ...entry })
      }
      if (status >= 400) {
        const rec = { method: res.request().method(), url: url.replace(BASE, ''), status, body: '' }
        b.failedRequests.push(rec)
        pending.push(
          res
            .text()
            .then((t) => {
              rec.body = t.slice(0, 400)
            })
            .catch(() => {})
        )
      }
    })
  }

  async function step(page, name, fn, opts = {}) {
    cur = { name, url: '', status: 'OK', consoleErrors: [], consoleWarnings: [], pageErrors: [], failedRequests: [], apiCalls: [], popups: [], note: '', ui: '', screenshot: '' }
    const started = Date.now()
    let note = ''
    try {
      const r = await Promise.race([
        fn(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('step timeout 60s')), opts.timeout ?? 60000))
      ])
      if (typeof r === 'string') note = r
      else if (r && typeof r === 'object') {
        note = r.note ?? ''
        if (r.ui) cur.ui = r.ui
        if (r.status) cur.status = r.status
      }
    } catch (e) {
      if (e instanceof NotFound) {
        cur.status = 'NOT-FOUND-IN-UI'
        note = e.message
      } else {
        cur.status = 'ERROR'
        note = `exception: ${String(e.message).split('\n')[0].slice(0, 300)}`
      }
    }
    await page.waitForTimeout(opts.settle ?? 700)
    await Promise.all(pending.splice(0))
    cur.url = page.url()
    cur.durationMs = Date.now() - started
    // Blank detection: main region has almost no text.
    try {
      const mainText = await page.locator('main').first().innerText({ timeout: 1500 })
      cur.mainTextLen = mainText.trim().length
      if (cur.status === 'OK' && cur.mainTextLen < 5 && !opts.allowBlank) cur.status = 'BLANK'
    } catch {
      cur.mainTextLen = null
    }
    const realReqFails = cur.failedRequests.filter((r) => r.status !== null || !/ERR_ABORTED/.test(r.failure ?? ''))
    if (cur.status === 'OK' && (realReqFails.length > 0 || cur.pageErrors.length > 0 || cur.consoleErrors.length > 0)) {
      cur.status = 'ERROR'
    }
    cur.note = note
    const file = `${process.env.RUN || "all"}-${String(results.length + 1).padStart(3, '0')}-${name.replace(/[^a-z0-9]+/gi, '_').slice(0, 50)}.jpg`
    try {
      await page.screenshot({ path: path.join(SCREENS, file), type: 'jpeg', quality: 45, timeout: 5000 })
      cur.screenshot = `screens/${file}`
    } catch {}
    results.push(cur)
    try {
      fs.writeFileSync(path.join(OUT, `partial-${process.env.RUN || 'all'}.json`), JSON.stringify(results, null, 1))
    } catch {}
    process.stdout.write(`[${cur.status}] ${name} — ${note.slice(0, 160)}${cur.failedRequests.length ? ` | fails: ${cur.failedRequests.map((f) => `${f.status ?? f.failure} ${f.url.split('?')[0]}`).join(', ').slice(0, 300)}` : ''}\n`)
    cur = null
  }

  return { results, apiLog, attach, step }
}

async function snap(locator, max = 2500) {
  try {
    return (await locator.ariaSnapshot({ timeout: 3000 })).slice(0, max)
  } catch (e) {
    return `(no snapshot: ${String(e.message).split('\n')[0]})`
  }
}

// Click that tolerates overlapped/out-of-viewport targets: try a normal click,
// then scrollIntoView + DOM click.
async function smartClick(locator, timeout = 4000) {
  const l = locator.first()
  try {
    await l.click({ timeout })
  } catch (e) {
    await l.evaluate((el) => {
      el.scrollIntoView({ block: 'center' })
      el.click()
    }, undefined, { timeout: 2000 })
  }
}

// Hard reset: reload the SPA, accept disclaimer, open HG006 SNV/Indel tab with no filters.
async function resetApp(page, mode = 'case') {
  await page.goto('http://127.0.0.1:8900/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const disc = page.getByRole('button', { name: /I Understand/ })
  if (await disc.isVisible().catch(() => false)) await disc.click()
  if (mode === 'none') return
  await page.getByRole('listbox', { name: 'Cases' }).getByRole('option', { name: /HG006/ }).click()
  await page.waitForTimeout(2000)
  if (mode === 'cohort') {
    await page.getByRole('button', { name: 'Cohort mode' }).click()
    await page.waitForTimeout(3000)
  } else {
    await page.getByRole('tab', { name: /SNV\/Indel/ }).click()
    await page.waitForTimeout(1500)
  }
  const box = page.locator('main').getByRole('textbox', { name: 'Search variants (text or filter DSL)' }).filter({ visible: true }).first()
  if (await box.isVisible().catch(() => false)) {
    const v = await box.inputValue().catch(() => '')
    if (v) {
      await box.fill('')
      await box.press('Enter')
    }
  }
  const clr = page.locator('main').getByRole('button', { name: /^Clear( all)?$/ }).filter({ visible: true })
  for (let i = 0; i < (await clr.count()); i++) {
    if (await clr.nth(i).isEnabled().catch(() => false)) await clr.nth(i).click().catch(() => {})
  }
  await page.waitForTimeout(1200)
}

async function closeOverlays(page) {
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Escape').catch(() => {})
    await page.waitForTimeout(150)
  }
}

async function visible(locator, timeout = 2500) {
  try {
    await locator.first().waitFor({ state: 'visible', timeout })
    return true
  } catch {
    return false
  }
}

module.exports = { resetApp, smartClick, chromium, BASE, OUT, SCREENS, createHarness, snap, closeOverlays, visible, notFound, NotFound }
