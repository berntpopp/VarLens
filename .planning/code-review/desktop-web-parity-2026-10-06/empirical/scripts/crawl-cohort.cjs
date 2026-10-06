// Cohort view interactions (each step starts from a fresh reload in cohort mode).
module.exports = async function cohortSteps(ctx) {
  const { page, h, snap, closeOverlays, visible, notFound, smartClick } = ctx
  const { resetApp } = require('./crawl-lib.cjs')
  const main = () => page.locator('main')
  const overlay = () => page.locator('.v-overlay--active .v-overlay__content').last()
  const filterNav = () => main().getByRole('navigation', { name: 'Filter options' })
  const step = (name, fn, opts = {}) =>
    h.step(page, name, async () => {
      await resetApp(page, opts.reset ?? 'cohort')
      return fn()
    }, opts)
  async function counts() {
    const t = (await main().innerText().catch(() => '')).replace(/\s+/g, ' ')
    const m = t.match(/([\d,]+) \/ ([\d,]+)/)
    const pg = t.match(/\d+-\d+ of [\d,]+/)
    return `${m ? `${m[1]} / ${m[2]}` : '?'}${pg ? ` (${pg[0]})` : ''}`
  }

  await step('cohort: switch to cohort mode', async () => {
    return { note: `${await counts()} :: ${(await main().innerText()).replace(/\s+/g, ' ').slice(0, 250)}`, ui: await snap(main(), 2500) }
  }, { reset: 'case' })

  await step('cohort: tabs present', async () => {
    const tabs = await main().getByRole('tab').allInnerTexts()
    return `tabs: ${tabs.map((t) => t.replace(/\s+/g, ' ').trim()).join(' | ')}`
  })

  for (const col of ['Gene', 'Position', 'gnomAD AF']) {
    await step(`cohort-table: sort by ${col}`, async () => {
      const b = main().getByRole('button', { name: `Sort by ${col}`, exact: true })
      if (!(await visible(b))) notFound(`cohort Sort by ${col} missing`)
      await smartClick(b)
      await page.waitForTimeout(1500)
      const a = (await main().locator('table tbody tr').first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 90)
      await smartClick(b)
      await page.waitForTimeout(1500)
      const z = (await main().locator('table tbody tr').first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 90)
      return `asc: ${a} || desc: ${z}`
    })
  }

  await step('cohort-table: text search', async () => {
    const box = main().getByRole('textbox').filter({ visible: true }).first()
    await box.fill('ZNRF3')
    await box.press('Enter')
    await page.waitForTimeout(2000)
    return `after ZNRF3: ${await counts()}`
  })

  await step('cohort-table: filter drawer (MOD)', async () => {
    if (!(await visible(filterNav(), 600))) await smartClick(main().getByRole('button', { name: 'Filters', exact: true }))
    await page.waitForTimeout(900)
    if (!(await visible(filterNav(), 2000))) return { status: 'ERROR', note: 'filter drawer did not open' }
    const ui = await snap(filterNav(), 2500)
    await smartClick(filterNav().getByText('MOD', { exact: true }))
    await page.waitForTimeout(2000)
    return { note: `with MOD: ${await counts()}`, ui }
  })

  await step('cohort-table: inheritance / analysis-group filter group', async () => {
    if (!(await visible(filterNav(), 600))) await smartClick(main().getByRole('button', { name: 'Filters', exact: true }))
    await page.waitForTimeout(900)
    await smartClick(filterNav().getByRole('button', { name: 'Expand all' })).catch(() => {})
    await page.waitForTimeout(1500)
    const t = (await filterNav().innerText().catch(() => '')).replace(/\s+/g, ' ')
    return /Inheritance|Analysis group/i.test(t) ? `present: ${t.match(/(Inheritance|Analysis group).{0,150}/i)[0]}` : { status: 'NOT-FOUND-IN-UI', note: 'no Inheritance/analysis-group filter in cohort drawer' }
  })

  await step('cohort-table: columns panel', async () => {
    await smartClick(main().getByRole('button', { name: 'Columns', exact: true }))
    await page.waitForTimeout(900)
    const t = (await main().innerText()).match(/\d+ of \d+ columns visible/)
    return `columns panel: ${t ? t[0] : 'not found'}`
  })

  await step('cohort-table: row click -> details / carriers', async () => {
    await smartClick(main().locator('table tbody tr').first())
    await page.waitForTimeout(3000)
    const panel = page.getByRole('complementary').first()
    const txt = (await panel.innerText().catch(() => '')).replace(/\s+/g, ' ')
    return { note: txt.slice(0, 350) || 'no complementary panel', ui: await snap(panel, 2500), status: txt ? undefined : 'ERROR' }
  })

  await step('cohort: gene burden tab', async () => {
    await smartClick(main().getByRole('tab', { name: /Gene Burden/ }))
    await page.waitForTimeout(4000)
    return { note: (await main().innerText()).replace(/\s+/g, ' ').slice(0, 400), ui: await snap(main(), 3500) }
  })

  await step('cohort: run association (gene burden compare)', async () => {
    await smartClick(main().getByRole('tab', { name: /Gene Burden/ }))
    await page.waitForTimeout(3000)
    const btns = (await main().getByRole('button').allInnerTexts()).map((b) => b.trim()).filter(Boolean)
    const run = main().getByRole('button', { name: /^(run|compare|analy[sz]e|start)/i })
    if (!(await visible(run, 1500))) return { status: 'NOT-FOUND-IN-UI', note: `no run button; buttons: ${btns.join(' | ').slice(0, 300)}` }
    const disabled = !(await run.first().isEnabled())
    if (disabled) {
      // try to fill group A/B selectors
      const fields = main().locator('.v-field').filter({ visible: true })
      const n = await fields.count()
      for (let i = 0; i < Math.min(n, 4); i++) {
        await smartClick(fields.nth(i)).catch(() => {})
        await page.waitForTimeout(500)
        const o = overlay().getByRole('option')
        if ((await o.count()) > 0) await smartClick(o.first()).catch(() => {})
        await page.keyboard.press('Escape')
        await page.waitForTimeout(300)
      }
    }
    const enabled = await run.first().isEnabled()
    if (enabled) await smartClick(run.first())
    await page.waitForTimeout(5000)
    const snack = (await page.locator('.v-snackbar').allInnerTexts().catch(() => [])).join(' ').replace(/\s+/g, ' ')
    return { note: `run enabled=${enabled}; buttons: ${btns.join(' | ').slice(0, 200)}; snackbar: ${snack.slice(0, 200)}; text: ${(await main().innerText()).replace(/\s+/g, ' ').slice(0, 200)}` }
  }, { timeout: 60000 })

  await step('cohort: export', async () => {
    const b = main().getByRole('button', { name: 'Export', exact: true })
    if (!(await visible(b, 1500))) notFound('cohort Export button missing')
    const dl = page.waitForEvent('download', { timeout: 8000 }).catch(() => null)
    await smartClick(b)
    await page.waitForTimeout(1500)
    const menu = (await overlay().innerText().catch(() => '')).replace(/\s+/g, ' ')
    const got = await dl
    const snack = (await page.locator('.v-snackbar').allInnerTexts().catch(() => [])).join(' ').replace(/\s+/g, ' ')
    return { note: `download: ${got ? got.suggestedFilename() : 'none'}; snackbar: "${snack.slice(0, 200)}"; overlay: ${menu.slice(0, 150)}`, status: /not available|failed/i.test(snack) ? 'ERROR' : undefined }
  })

  await step('cohort: case-filter comboboxes (cohort/HPO)', async () => {
    const fields = main().locator('.v-field').filter({ visible: true })
    const n = await fields.count()
    const parts = []
    for (let i = 0; i < Math.min(n, 3); i++) {
      const label = (await fields.nth(i).innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 40)
      await smartClick(fields.nth(i)).catch(() => {})
      await page.waitForTimeout(900)
      parts.push(`${label}: ${(await overlay().innerText().catch(() => '(none)')).replace(/\s+/g, ' ').slice(0, 100)}`)
      await closeOverlays(page)
    }
    return parts.join(' || ')
  })
}
