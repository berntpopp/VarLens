// Track 8 E2E: log in to the built web instance, open a case, export -> download; same for cohort.
// Usage (from the repo root, server on BASE): VARLENS_E2E_PASSWORD=... node <this file> <outdir>
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'

const WT = process.env.VARLENS_WT ?? process.cwd()
const require = createRequire(`${WT}/package.json`)
const { chromium } = require('playwright')

const BASE = process.env.BASE ?? 'http://127.0.0.1:8890'
const OUT = process.argv[2] ?? process.cwd()
const CASE_NAME = `e2e-export-${Date.now()}`
const ROWS = 30
const HEADERS = { origin: BASE }

function buildVcf(rowCount) {
  const source = readFileSync(`${WT}/tests/test-data/vcf/synthetic-unit-test.vcf`, 'utf8').split('\n')
  const meta = source.filter((l) => l.startsWith('##'))
  const header = source.find((l) => l.startsWith('#CHROM')).split('\t').slice(0, 10)
  const templates = source.filter((l) => l && !l.startsWith('#')).slice(0, 3).map((l) => l.split('\t').slice(0, 10))
  const body = []
  for (let i = 0; i < rowCount; i += 1) {
    const f = [...templates[i % 3]]
    f[1] = String(20_000_000 + i * 10)
    f[2] = '.'
    body.push(f.join('\t'))
  }
  return [...meta, header.join('\t'), ...body, ''].join('\n')
}

const results = { base: BASE, caseName: CASE_NAME }
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1600, height: 1000 } })
await context.addInitScript(() => {
  try { localStorage.setItem('varlens_disclaimer_acknowledged_version', '9.9.9') } catch {}
})
const page = await context.newPage()
const consoleErrors = []
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })

try {
  const login = await page.request.post(`${BASE}/api/auth/login`, {
    headers: HEADERS, data: { args: [process.env.VARLENS_E2E_USER ?? 'admin', process.env.VARLENS_E2E_PASSWORD] }
  })
  results.login = login.status()
  const upload = await page.request.post(`${BASE}/api/import/upload`, {
    headers: { ...HEADERS, 'content-type': 'application/octet-stream', 'x-varlens-file-name': `${CASE_NAME}.vcf` },
    data: Buffer.from(buildVcf(ROWS))
  })
  const { ref } = await upload.json()
  const imported = await page.request.post(`${BASE}/api/import/start`, {
    headers: HEADERS, data: { args: [ref, CASE_NAME, { genomeBuild: 'hg38' }] }
  })
  results.import = await imported.json()

  await page.goto(`${BASE}/`)
  const ack = page.getByRole('button', { name: /I Understand/ })
  await ack.click({ timeout: 5000 }).catch(() => {})
  await page.getByText(CASE_NAME, { exact: true }).first().click()
  await page.waitForTimeout(1000)
  await page.getByRole('tab', { name: /SNV\/Indel/ }).click()
  await page.waitForTimeout(1500)
  await page.locator('.v-main').getByText('HIGH Impact', { exact: true }).first().click()
  await page.waitForTimeout(1500)
  results.caseFilteredCountChip = await page.locator('.v-main').getByText(/\d+ \/ 30/).first().innerText().catch(() => null)
  await page.screenshot({ path: `${OUT}/t8-case-view.png` })

  const exportBtn = page.locator('.v-main button:has-text("Export")').first()
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 20_000 }), exportBtn.click()])
  const casePath = `${OUT}/t8-${download.suggestedFilename()}`
  await download.saveAs(casePath)
  const caseLines = readFileSync(casePath, 'utf8').split('\r\n').filter(Boolean)
  results.caseExport = {
    suggestedFilename: download.suggestedFilename(),
    url: download.url().replace(BASE, ''),
    failure: await download.failure(),
    header: caseLines[0],
    dataRows: caseLines.length - 1
  }
  await page.waitForTimeout(500)
  results.caseSnackbar = await page.locator('.v-snackbar').allInnerTexts()

  await page.getByRole('button', { name: 'Cohort mode' }).click()
  await page.waitForTimeout(2500)
  results.cohortFilterApplied = await page.locator('.v-main').getByText('HIGH Impact', { exact: true }).first()
    .click({ timeout: 5000 }).then(() => true).catch(() => false)
  await page.waitForTimeout(2000)
  await page.screenshot({ path: `${OUT}/t8-cohort-view.png` })
  const cohortBtn = page.locator('.v-main button:has-text("Export")').first()
  const [cohortDl] = await Promise.all([page.waitForEvent('download', { timeout: 20_000 }), cohortBtn.click()])
  const cohortPath = `${OUT}/t8-${cohortDl.suggestedFilename()}`
  await cohortDl.saveAs(cohortPath)
  const cohortLines = readFileSync(cohortPath, 'utf8').split('\r\n').filter(Boolean)
  results.cohortExport = {
    suggestedFilename: cohortDl.suggestedFilename(),
    url: cohortDl.url().replace(BASE, ''),
    failure: await cohortDl.failure(),
    header: cohortLines[0],
    dataRows: cohortLines.length - 1
  }
  await page.waitForTimeout(500)
  results.cohortSnackbar = await page.locator('.v-snackbar').allInnerTexts()
} catch (error) {
  results.error = String(error)
  await page.screenshot({ path: `${OUT}/t8-error.png` }).catch(() => {})
} finally {
  results.consoleErrors = consoleErrors
  writeFileSync(`${OUT}/t8-e2e-result.json`, JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results, null, 2))
  await browser.close()
}
