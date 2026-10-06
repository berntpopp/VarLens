// Empirical web-mode crawl of VarLens (port 8900). Usage: node crawl.cjs
const fs = require('fs')
const path = require('path')
const { chromium, BASE, OUT, createHarness, snap, closeOverlays, visible, notFound, smartClick } = require('./crawl-lib.cjs')
const caseSteps = require('./crawl-case.cjs')
const cohortSteps = require('./crawl-cohort.cjs')
const shellSteps = require('./crawl-shell.cjs')

const VCF = '/home/bernt-popp/development/VarLens/.claude/worktrees/agent-a441a5be6bf38012d/tests/test-data/vcf'

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
  const h = createHarness()
  const downloads = []
  context.on('page', (p) => {
    h.attach(p)
  })
  const page = await context.newPage()
  page.setDefaultTimeout(6000)
  page.on('download', async (d) => {
    const target = path.join(OUT, 'downloads', d.suggestedFilename())
    fs.mkdirSync(path.dirname(target), { recursive: true })
    try {
      await d.saveAs(target)
      downloads.push({ name: d.suggestedFilename(), size: fs.statSync(target).size })
    } catch (e) {
      downloads.push({ name: d.suggestedFilename(), error: String(e.message) })
    }
  })
  context.on('page', (p) => {
    if (p !== page) {
      p.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {})
      setTimeout(() => {
        h.popups = h.popups ?? []
        h.popups.push(p.url())
        p.close().catch(() => {})
      }, 1500)
    }
  })

  const ctx = { page, h, VCF, downloads, snap, closeOverlays, visible, notFound, BASE, smartClick }

  await h.step(page, 'auth: unauthenticated root redirects to login', async () => {
    await page.goto(BASE + '/', { waitUntil: 'networkidle' })
    if (!/\/login/.test(page.url())) return { status: 'ERROR', note: `no redirect; at ${page.url()}` }
    return `redirected to ${page.url().replace(BASE, '')}`
  }, { allowBlank: true })

  await h.step(page, 'auth: login wrong password', async () => {
    await page.fill('input[name=username], #username', 'admin')
    await page.fill('input[type=password]', 'wrong-password')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(1500)
    const t = await page.locator('body').innerText()
    return { note: `stays on ${page.url().replace(BASE, '')}; message: ${t.replace(/\s+/g, ' ').slice(0, 200)}`, status: 'OK' }
  }, { allowBlank: true })

  await h.step(page, 'auth: login as admin', async () => {
    await page.goto(BASE + '/login', { waitUntil: 'networkidle' })
    await page.fill('input[name=username], #username', 'admin')
    await page.fill('input[type=password]', (process.env.VARLENS_CRAWL_PASSWORD || ''))
    await page.keyboard.press('Enter')
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 })
    await page.waitForTimeout(2500)
    return `landed on ${page.url().replace(BASE, '')}`
  })

  await h.step(page, 'disclaimer: accept', async () => {
    const b = page.getByRole('button', { name: /I Understand/ })
    if (await visible(b, 4000)) {
      await b.click()
      return 'disclaimer shown and accepted'
    }
    return 'no disclaimer shown (already accepted)'
  })

  const SECTIONS = (process.env.SECTIONS || 'case,cohort,shell').split(',')
  if (SECTIONS.includes('case')) await caseSteps(ctx)
  if (SECTIONS.includes('cohort')) await cohortSteps(ctx)
  if (SECTIONS.includes('shell')) await shellSteps(ctx)

  fs.writeFileSync(path.join(OUT, `crawl-results-${process.env.RUN || 'all'}.json`), JSON.stringify({ generatedAt: new Date().toISOString(), base: BASE, steps: h.results, downloads, popups: h.popups ?? [] }, null, 2))
  fs.writeFileSync(path.join(OUT, `crawl-api-log-${process.env.RUN || 'all'}.json`), JSON.stringify(h.apiLog, null, 2))
  const counts = h.results.reduce((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {})
  console.log('\nCOUNTS', JSON.stringify(counts))
  await browser.close()
})().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
