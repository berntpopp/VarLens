// Case view: case list, variant table interactions, details panel, case metadata.
module.exports = async function caseSteps(ctx) {
  const { page, h, snap, closeOverlays, visible, notFound, smartClick } = ctx
  const { resetApp } = require('./crawl-lib.cjs')
  const main = () => page.locator('main')
  const dialog = () => page.getByRole('dialog').last()
  const overlay = () => page.locator('.v-overlay--active .v-overlay__content').last()
  const panel = () => page.getByRole('complementary', { name: 'Variant details' })
  const searchBox = () => main().getByRole('textbox', { name: 'Search variants (text or filter DSL)' }).filter({ visible: true }).first()
  const filterNav = () => main().getByRole('navigation', { name: 'Filter options' })
  async function counts() {
    const tb = await main().getByRole('toolbar', { name: 'Variant filters' }).innerText().catch(() => '')
    const m = tb.replace(/\s+/g, ' ').match(/([\d,]+) \/ ([\d,]+)/)
    const pg = (await main().innerText().catch(() => '')).match(/\d+-\d+ of [\d,]+/)
    return `${m ? `${m[1]} / ${m[2]}` : '?'}${pg ? ` (${pg[0]})` : ''}`
  }
  async function openFilters() {
    if (!(await visible(filterNav(), 600))) {
      await smartClick(main().getByRole('button', { name: 'Filters', exact: true }))
      await page.waitForTimeout(800)
    }
    if (!(await visible(filterNav(), 2000))) throw new Error('filter drawer did not open')
  }
  async function clearFilters() {
    const b = main().getByRole('button', { name: 'Clear', exact: true })
    if (await b.isEnabled().catch(() => false)) await smartClick(b)
    await page.waitForTimeout(1200)
  }
  async function ensureDetails() {
    if (await visible(panel(), 800)) return
    await closeOverlays(page)
    await smartClick(main().locator('table tbody tr').first())
    await page.waitForTimeout(2500)
    if (!(await visible(panel(), 3000))) throw new Error('details panel not visible')
  }
  async function openMetaTab(label) {
    if (!(await visible(page.getByRole('button', { name: 'Overview', exact: true }), 800))) {
      await closeOverlays(page)
      await smartClick(main().getByRole('button', { name: 'Edit Case Phenotypes and Metadata' }))
      await page.waitForTimeout(1500)
    }
    if (label) {
      const t = page.getByRole('button', { name: new RegExp(`^${label}`) }).filter({ visible: true })
      if (!(await visible(t, 1500))) notFound(`metadata tab "${label}" missing`)
      await smartClick(t)
      await page.waitForTimeout(1500)
    }
  }
  const step = (name, fn, opts) =>
    h.step(page, name, async () => {
      if (opts?.reset) await resetApp(page, opts.reset)
      else if (!opts?.keepOverlays) await closeOverlays(page)
      return fn()
    }, opts)

  await step('case-list: sidebar renders cases', async () => {
    const lb = page.getByRole('listbox', { name: 'Cases' })
    if (!(await visible(lb, 8000))) return { status: 'ERROR', note: 'case listbox not visible' }
    return `${await lb.getByRole('option').count()} cases listed`
  })

  await step('case-list: search cases', async () => {
    await page.getByRole('textbox', { name: 'Search cases...' }).fill('HG006')
    await page.waitForTimeout(1000)
    const n = await page.getByRole('listbox', { name: 'Cases' }).getByRole('option').count()
    await page.getByRole('textbox', { name: 'Search cases...' }).fill('')
    await page.waitForTimeout(800)
    return `filter 'HG006' -> ${n} option(s)`
  })

  await step('case-list: cohort + HPO filter comboboxes', async () => {
    const nav = page.getByRole('navigation', { name: 'Cases sidebar' })
    const fields = nav.locator('.v-field')
    const n = await fields.count()
    const parts = []
    for (let i = 0; i < Math.min(n, 3); i++) {
      await smartClick(fields.nth(i))
      await page.waitForTimeout(1200)
      parts.push(`field ${i}: ${(await overlay().innerText().catch(() => '(no menu)')).replace(/\s+/g, ' ').slice(0, 150)}`)
      await closeOverlays(page)
    }
    return parts.join(' || ')
  })

  await step('case: select HG006 (shortlist tab)', async () => {
    await smartClick(page.getByRole('listbox', { name: 'Cases' }).getByRole('option', { name: /HG006/ }))
    await page.waitForTimeout(3000)
    return (await main().innerText()).replace(/\s+/g, ' ').slice(0, 220)
  })

  await step('case: shortlist preset switch', async () => {
    const cb = main().locator('.v-field').filter({ hasText: 'Preset' }).first()
    if (!(await visible(cb))) notFound('Shortlist preset select not found')
    await smartClick(cb)
    await page.waitForTimeout(800)
    const opts = await overlay().getByRole('option').allInnerTexts()
    if (opts.length > 1) await smartClick(overlay().getByRole('option').nth(opts.length - 1))
    await page.waitForTimeout(2000)
    return `presets: ${opts.join(' | ').replace(/\s+/g, ' ').slice(0, 200)}; now: ${(await main().innerText()).replace(/\s+/g, ' ').match(/Scored[^.]*?\)/)?.[0] ?? '?'}`
  })

  await step('variant-table: SNV/Indel tab loads', async () => {
    await smartClick(page.getByRole('tab', { name: /SNV\/Indel/ }))
    await page.waitForTimeout(2500)
    return `${await main().locator('table tbody tr').count()} rows; ${await counts()}`
  })

  for (const col of ['Position', 'Gene', 'gnomAD AF', 'CADD']) {
    await step(`variant-table: sort by ${col}`, async () => {
      const b = main().getByRole('button', { name: `Sort by ${col}`, exact: true })
      if (!(await visible(b))) notFound(`Sort by ${col} button missing`)
      await smartClick(b)
      await page.waitForTimeout(1500)
      const a = (await main().locator('table tbody tr').first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 90)
      await smartClick(b)
      await page.waitForTimeout(1500)
      const z = (await main().locator('table tbody tr').first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 90)
      return `asc first: ${a} || desc first: ${z}`
    }, { reset: 'case' })
  }

  await step('variant-table: column header filter (Gene)', async () => {
    const b = main().getByRole('button', { name: 'Filter Gene', exact: true })
    if (!(await visible(b))) notFound('Filter Gene button missing')
    await smartClick(b)
    await page.waitForTimeout(900)
    const ui = await snap(overlay(), 1200)
    const input = overlay().locator('input').filter({ visible: true }).first()
    if (await visible(input, 1500)) {
      await input.fill('ZNRF3')
      await input.press('Enter', { timeout: 2000 }).catch(() => {})
      await page.waitForTimeout(1800)
    }
    const c = await counts()
    await closeOverlays(page)
    await clearFilters()
    return { note: `after ZNRF3 header filter: ${c}`, ui }
  }, { reset: 'case' })

  await step('variant-table: text search (gene)', async () => {
    await searchBox().fill('ZNRF3')
    await searchBox().press('Enter')
    await page.waitForTimeout(2000)
    const c = await counts()
    await clearFilters()
    return `after search ZNRF3: ${c}`
  }, { reset: 'case' })

  await step('variant-table: DSL search gnomad_af:<:0.01', async () => {
    await searchBox().fill('gnomad_af:<:0.01')
    await searchBox().press('Enter')
    await page.waitForTimeout(2000)
    const c = await counts()
    await clearFilters()
    return `after DSL: ${c}`
  }, { reset: 'case' })

  await step('variant-table: filter drawer (Impact MOD + AF<=1%)', async () => {
    await openFilters()
    await smartClick(filterNav().getByText('MOD', { exact: true }))
    await page.waitForTimeout(1500)
    const a = await counts()
    await smartClick(filterNav().getByText('<= 1%', { exact: true }))
    await page.waitForTimeout(1500)
    return `MOD: ${a}; MOD+AF<=1%: ${await counts()}`
  }, { reset: 'case' })

  await step('variant-table: filter drawer expand all groups', async () => {
    await openFilters()
    await smartClick(filterNav().getByRole('button', { name: 'Expand all' }))
    await page.waitForTimeout(2500)
    const txt = (await filterNav().innerText()).replace(/\s+/g, ' ')
    await clearFilters()
    return { note: txt.slice(0, 400), ui: await snap(filterNav(), 4000) }
  })

  await step('variant-table: ClinVar + Consequence + Tags filter groups', async () => {
    await openFilters()
    const out = []
    for (const g of ['ClinVar', 'Consequence', 'Tags', 'Annotations', 'Internal Frequency', 'Structural Variants']) {
      const b = filterNav().getByRole('button', { name: g, exact: true })
      if (await visible(b, 600)) {
        await smartClick(b)
        await page.waitForTimeout(700)
        out.push(g)
      }
    }
    return `expanded: ${out.join(', ')}`
  })

  await step('variant-table: filter preset chip (Rare (1%))', async () => {
    await smartClick(main().getByRole('button', { name: 'Filter preset: Rare (1%)' }))
    await page.waitForTimeout(2000)
    return `after preset: ${await counts()}`
  }, { reset: 'case' })

  await step('filter-presets: save current filters as preset', async () => {
    const save = main().getByRole('button', { name: 'Save', exact: true })
    if (!(await visible(save, 1500))) notFound('no "Save" preset button')
    await smartClick(save)
    await page.waitForTimeout(1000)
    const d = dialog()
    const ui = await snap(d, 1500)
    await d.getByRole('textbox').first().fill('Parity crawl preset')
    await smartClick(d.getByRole('button', { name: /^save/i }).last())
    await page.waitForTimeout(1500)
    const listed = await visible(main().getByRole('button', { name: 'Filter preset: Parity crawl preset' }), 2000)
    return { note: listed ? 'preset saved and chip shown' : 'saved but chip not shown', ui, status: listed ? undefined : 'ERROR' }
  })

  await step('filter-presets: manage presets + delete crawl preset', async () => {
    await smartClick(main().getByRole('button', { name: 'Manage presets' }).filter({ visible: true }).first())
    await page.waitForTimeout(1200)
    const d = dialog()
    const ui = await snap(d, 2500)
    const del = d.getByRole('button', { name: /delete.*Parity crawl preset/i })
    if (!(await visible(del, 1500))) return { note: 'manage dialog opened; no per-preset delete button found for crawl preset', ui, status: 'NOT-FOUND-IN-UI' }
    await smartClick(del)
    await page.waitForTimeout(800)
    const c = page.getByRole('button', { name: /^(delete|confirm|yes)$/i }).filter({ visible: true })
    if (await visible(c, 1000)) await smartClick(c.last())
    await page.waitForTimeout(1500)
    return { note: 'deleted', ui }
  })

  await step('variant-table: columns panel toggle + reset', async () => {
    await clearFilters()
    await smartClick(main().getByRole('button', { name: 'Columns', exact: true }))
    await page.waitForTimeout(900)
    const panelNav = main().getByRole('navigation').filter({ hasText: 'columns visible' })
    if (!(await visible(panelNav, 2000))) return { status: 'ERROR', note: 'columns panel did not open' }
    await smartClick(panelNav.getByRole('listitem').filter({ hasText: 'Qual' }).getByRole('checkbox'))
    await page.waitForTimeout(900)
    const m = (await panelNav.innerText()).match(/\d+ of \d+ columns visible/)
    const qualHeader = await visible(main().getByRole('button', { name: 'Sort by Qual', exact: true }), 800)
    await smartClick(panelNav.getByRole('button', { name: 'Reset' }))
    await page.waitForTimeout(900)
    await smartClick(panelNav.getByRole('button', { name: 'Close columns panel' })).catch(() => {})
    return `after toggling Qual: ${m ? m[0] : '?'}, Qual header visible=${qualHeader}; reset clicked`
  }, { reset: 'case' })

  await step('variant-table: pagination (next page, page size)', async () => {
    const before = await counts()
    const next = main().getByRole('button', { name: /next page/i })
    if (!(await visible(next, 1500))) notFound('no Next page button')
    await smartClick(next)
    await page.waitForTimeout(1800)
    const after = await counts()
    const sel = main().locator('.v-data-table-footer .v-field').first()
    let size = ''
    if (await visible(sel, 800)) {
      await smartClick(sel)
      await page.waitForTimeout(600)
      const opts = overlay().getByRole('option')
      const n = await opts.count()
      if (n > 1) await smartClick(opts.nth(1))
      await page.waitForTimeout(1800)
      size = await counts()
    }
    return `before ${before}; after next ${after}; after page-size change ${size}`
  }, { reset: 'case' })

  await step('variant-details: open MOD (missense) row', async () => {
    await clearFilters()
    await openFilters()
    await smartClick(filterNav().getByText('MOD', { exact: true }))
    await page.waitForTimeout(1500)
    await smartClick(filterNav().getByRole('button', { name: 'Done' })).catch(() => {})
    await page.waitForTimeout(500)
    await smartClick(main().locator('table tbody tr').first())
    await page.waitForTimeout(2500)
    if (!(await visible(panel(), 3000))) return { status: 'ERROR', note: 'details panel not visible' }
    return { note: (await panel().innerText()).replace(/\s+/g, ' ').slice(0, 300), ui: await snap(panel(), 3000) }
  }, { reset: 'case' })

  await step('variant-details: Fetch VEP (+ MyVariant/SpliceAI enrichment)', async () => {
    await ensureDetails()
    await smartClick(panel().getByRole('button', { name: 'Fetch VEP' }))
    await page.waitForTimeout(9000)
    const txt = (await panel().innerText()).replace(/\s+/g, ' ')
    const snack = (await page.locator('.v-snackbar').allInnerTexts().catch(() => [])).join(' ').replace(/\s+/g, ' ')
    const i = txt.indexOf('Transcripts')
    return `panel: ${txt.slice(i, i + 160)} … scores: ${txt.slice(txt.indexOf('Annotation Scores'), txt.indexOf('Annotation Scores') + 120)} | snackbar: ${snack.slice(0, 200)}`
  }, { timeout: 40000 })

  await step('variant-details: expand transcript table', async () => {
    await ensureDetails()
    await smartClick(panel().getByRole('button', { name: 'Expand transcript table' }))
    await page.waitForTimeout(1500)
    const t = (await overlay().innerText().catch(() => '')).replace(/\s+/g, ' ')
    return `expanded view: ${t.slice(0, 250) || '(inline)'}`
  })

  await step('protein-view: open modal (structure/lollipop/gnomAD ClinVar)', async () => {
    await ensureDetails()
    await smartClick(panel().getByRole('button', { name: 'Open protein view' }))
    await page.waitForTimeout(6000)
    const txt = (await overlay().innerText().catch(() => '')).replace(/\s+/g, ' ')
    const unavailable = /not available in web mode/i.test(txt)
    return { note: txt.slice(0, 350), status: unavailable ? 'ERROR' : undefined }
  }, { timeout: 45000 })

  await step('acmg: evidence editor (PM2 + PP3 autosave)', async () => {
    await ensureDetails()
    const editorBtn = panel().getByRole('button', { name: /^Evidence editor/ })
    const expanded = await editorBtn.getAttribute('aria-expanded').catch(() => null)
    if (expanded !== 'true') await smartClick(editorBtn)
    await page.waitForTimeout(800)
    await smartClick(panel().getByRole('button', { name: /^PM2:/ }))
    await page.waitForTimeout(800)
    await smartClick(panel().getByRole('button', { name: /^PP3:/ }))
    await page.waitForTimeout(2000)
    const txt = (await panel().innerText()).replace(/\s+/g, ' ')
    const i = txt.indexOf('ACMG Classification')
    return txt.slice(i, i + 160)
  })

  await step('acmg: auto-suggest + evidence notes', async () => {
    await ensureDetails()
    const as = panel().getByRole('button', { name: 'Auto-suggest' })
    if (await visible(as, 1000)) await smartClick(as)
    await page.waitForTimeout(1500)
    const notes = panel().getByRole('textbox', { name: 'Evidence notes...' })
    if (await visible(notes, 1000)) {
      await notes.fill('parity crawl evidence note')
      await notes.evaluate((e) => e.blur())
    }
    await page.waitForTimeout(1500)
    return (await panel().innerText()).replace(/\s+/g, ' ').match(/ACMG Classification.{0,140}/)?.[0] ?? ''
  })

  await step('acmg: quick classify via LP chip', async () => {
    await ensureDetails()
    await smartClick(panel().getByText('LP', { exact: true }).first())
    await page.waitForTimeout(1500)
    const dlg = (await overlay().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200)
    const c = page.getByRole('button', { name: /confirm|apply|override|yes/i }).filter({ visible: true })
    if (await visible(c, 800)) await smartClick(c.last())
    await page.waitForTimeout(1200)
    return `overlay: ${dlg || '(none)'}; panel: ${(await panel().innerText()).replace(/\s+/g, ' ').match(/ACMG Classification.{0,100}/)?.[0] ?? ''}`
  })

  await step('tags: create tag via Settings > Custom Tags', async () => {
    await smartClick(page.getByRole('button', { name: 'Application settings' }))
    await page.waitForTimeout(700)
    await smartClick(overlay().getByText('Custom Tags', { exact: true }))
    await page.waitForTimeout(1500)
    const d = dialog()
    await smartClick(d.getByRole('button', { name: 'Add Tag' }))
    await page.waitForTimeout(700)
    await d.getByRole('textbox', { name: 'Tag Name' }).fill('parity-tag')
    await smartClick(d.getByRole('button', { name: /^(save|create|add)$/i }).last())
    await page.waitForTimeout(1500)
    const ok = (await d.innerText()).includes('parity-tag')
    return { note: ok ? 'tag created' : 'tag not listed after save', status: ok ? undefined : 'ERROR', ui: await snap(d, 1500) }
  })

  await step('tags: assign tag to variant', async () => {
    await ensureDetails()
    await smartClick(panel().getByRole('button', { name: 'Add tag' }))
    await page.waitForTimeout(1000)
    const t = (await overlay().innerText().catch(() => '')).replace(/\s+/g, ' ')
    const item = overlay().getByText('parity-tag').first()
    if (!(await visible(item, 1500))) return { status: 'ERROR', note: `tag menu: ${t.slice(0, 150)}` }
    await smartClick(item)
    await page.waitForTimeout(1500)
    await closeOverlays(page)
    const pt = (await panel().innerText()).replace(/\s+/g, ' ')
    return pt.includes('parity-tag') ? 'tag chip shown on variant' : { status: 'ERROR', note: 'tag chip not shown' }
  })

  for (const [label, ph, text] of [
    ['comments: add global comment', 'Add a global comment...', 'Parity crawl global comment'],
    ['comments: add case comment', 'Add a case-specific comment...', 'Parity crawl case comment']
  ]) {
    await step(label, async () => {
      await ensureDetails()
      const t = panel().getByText(ph)
      if (!(await visible(t, 1500))) notFound(`${ph} missing`)
      await smartClick(t)
      await page.waitForTimeout(700)
      const ta = panel().locator('textarea:not([placeholder="Evidence notes..."])').filter({ visible: true }).first()
      await ta.evaluate((e) => {
        e.scrollIntoView({ block: 'center' })
        e.focus()
      })
      await page.keyboard.type(text, { delay: 5 })
      await ta.evaluate((e) => e.blur())
      await page.waitForTimeout(2500)
      return (await panel().innerText()).includes(text) ? 'comment persisted in panel' : { status: 'ERROR', note: 'comment not visible after blur-save' }
    })
  }

  await step('variant-details: activity log', async () => {
    await ensureDetails()
    await smartClick(panel().getByRole('button', { name: 'Activity Log' }))
    await page.waitForTimeout(2500)
    const txt = (await panel().innerText()).replace(/\s+/g, ' ')
    const i = txt.indexOf('Activity Log')
    return txt.slice(i, i + 350)
  })

  await step('variant-details: external links (ClinVar, gnomAD)', async () => {
    await ensureDetails()
    const before = (h.popups ?? []).length
    await smartClick(panel().getByRole('button', { name: 'Open ClinVar' }))
    await page.waitForTimeout(800)
    await smartClick(panel().getByRole('button', { name: 'Open gnomAD' }))
    await page.waitForTimeout(3000)
    return `popups opened: ${(h.popups ?? []).slice(before).join(' , ') || 'none'}`
  })

  await step('variant-details: broadcast to local IGV', async () => {
    await ensureDetails()
    await smartClick(panel().getByRole('button', { name: 'Broadcast locus to local IGV' }))
    await page.waitForTimeout(2500)
    const snack = (await page.locator('.v-snackbar').allInnerTexts().catch(() => [])).join(' ')
    return `snackbar: ${snack.replace(/\s+/g, ' ').slice(0, 200) || '(none)'}`
  })

  await step('variant-details: copy HGVS', async () => {
    await ensureDetails()
    await smartClick(panel().getByRole('button', { name: 'Copy HGVS notation' }))
    await page.waitForTimeout(1200)
    const snack = (await page.locator('.v-snackbar').allInnerTexts().catch(() => [])).join(' ')
    return `snackbar: ${snack.replace(/\s+/g, ' ').slice(0, 160) || '(none)'}`
  })

  await step('shortlist: star variant + starred-only filter', async () => {
    const rowStar = main().locator('table tbody tr').first().locator('button, .v-icon').first()
    await smartClick(rowStar)
    await page.waitForTimeout(1200)
    await smartClick(main().getByRole('button', { name: 'Starred variants only' }))
    await page.waitForTimeout(1800)
    const c = await counts()
    await smartClick(main().getByRole('button', { name: 'Starred variants only' }))
    await page.waitForTimeout(1000)
    await smartClick(page.getByRole('tab', { name: 'Shortlist' }))
    await page.waitForTimeout(2500)
    const sl = (await main().innerText()).replace(/\s+/g, ' ').slice(0, 200)
    await smartClick(page.getByRole('tab', { name: /SNV\/Indel/ }))
    await page.waitForTimeout(1500)
    return `starred-only: ${c}; shortlist tab: ${sl}`
  }, { reset: 'case' })

  await step('export: case export menu + every option', async () => {
    await clearFilters()
    const b = main().getByRole('button', { name: 'Export', exact: true })
    await smartClick(b)
    await page.waitForTimeout(1000)
    const ui = await snap(overlay(), 2000)
    const items = overlay().locator('.v-list-item')
    const n = await items.count()
    const done = []
    for (let i = 0; i < n; i++) {
      if (i > 0) {
        await closeOverlays(page)
        await smartClick(b)
        await page.waitForTimeout(900)
      }
      const it = overlay().locator('.v-list-item').nth(i)
      const label = (await it.innerText().catch(() => '?')).replace(/\s+/g, ' ').trim()
      const dl = page.waitForEvent('download', { timeout: 10000 }).catch(() => null)
      await smartClick(it).catch(() => {})
      await page.waitForTimeout(1200)
      const dd = dialog()
      if (await visible(dd, 800)) {
        const go = dd.getByRole('button', { name: /^(export|download|save)/i })
        if (await visible(go, 800)) await smartClick(go.last()).catch(() => {})
      }
      const got = await dl
      const snack = (await page.locator('.v-snackbar').allInnerTexts().catch(() => [])).join(' ').replace(/\s+/g, ' ').slice(0, 140)
      done.push(`${label} -> ${got ? `download ${got.suggestedFilename()}` : 'no download'}${snack ? ` [snackbar: ${snack}]` : ''}`)
    }
    let snack = ''
    if (n === 0) snack = (await page.locator('.v-snackbar').allInnerTexts().catch(() => [])).join(' ').replace(/\s+/g, ' ')
    await closeOverlays(page)
    const blocked = /not available|failed/i.test(snack)
    return { note: (done.join(' ; ') || `no menu; click result snackbar: "${snack.slice(0, 200)}"`), ui, status: blocked ? 'ERROR' : undefined }
  }, { reset: 'case', timeout: 150000 })

  await step('case-metadata: open modal (overview)', async () => {
    await openMetaTab(null)
    return { note: (await dialog().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300), ui: await snap(dialog(), 3000) }
  }, { reset: 'case' })

  await step('case-metadata: HPO term search + add', async () => {
    await openMetaTab(null)
    const inp = page.locator('input[placeholder="Search HPO terms..."], input[placeholder="HPO search unavailable"]').filter({ visible: true }).first()
    if (!(await visible(inp, 2000))) notFound('HPO input not found in metadata modal')
    const ph = await inp.getAttribute('placeholder')
    await inp.fill('seizure')
    await page.waitForTimeout(3500)
    const opts = overlay().getByRole('option')
    const n = await opts.count()
    if (n > 0) await smartClick(opts.first())
    await page.waitForTimeout(1500)
    return { note: `placeholder "${ph}"; ${n} suggestions for 'seizure'`, status: n === 0 ? 'ERROR' : undefined }
  }, { reset: 'case' })

  await step('case-metadata: set sex via overview', async () => {
    await openMetaTab('Overview')
    const d = dialog()
    const sexRow = d.locator('div').filter({ hasText: /^Sex/ }).locator('.v-field, .v-chip, button').first()
    if (!(await visible(sexRow, 1500))) notFound('sex control not found')
    await smartClick(sexRow)
    await page.waitForTimeout(800)
    const opt = overlay().getByText(/female/i).first()
    if (await visible(opt, 800)) await smartClick(opt)
    await page.waitForTimeout(1500)
    return (await d.innerText()).replace(/\s+/g, ' ').slice(0, 200)
  }, { reset: 'case' })

  await step('case-metadata: comments tab create', async () => {
    await openMetaTab('Comments')
    const d = dialog()
    const ta = d.getByRole('textbox', { name: 'Add a comment...' })
    if (!(await visible(ta, 1500))) notFound('case comment textarea missing')
    await ta.fill('Parity crawl case-level comment')
    await smartClick(d.getByRole('button', { name: /^(add|post|save|comment)/i }).last())
    await page.waitForTimeout(1800)
    return (await d.innerText()).includes('Parity crawl case-level comment') ? 'comment listed' : { status: 'ERROR', note: 'comment not listed' }
  }, { reset: 'case' })

  await step('case-metadata: metrics tab (create definition)', async () => {
    await openMetaTab('Metrics')
    const d = dialog()
    const ui = await snap(d, 2000)
    const inp = d.getByRole('combobox', { name: 'Add a metric...' }).or(d.getByRole('textbox', { name: 'Add a metric...' })).first()
    if (!(await visible(inp, 1500))) return { note: 'metrics tab opened; add-metric input not found', ui, status: 'NOT-FOUND-IN-UI' }
    await smartClick(inp)
    await page.waitForTimeout(800)
    const menu = (await overlay().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200)
    return { note: `metric picker: ${menu}`, ui }
  }, { reset: 'case' })

  await step('case-metadata: data info tab', async () => {
    await closeOverlays(page)
    await openMetaTab('Data Info')
    return { note: (await dialog().innerText()).replace(/\s+/g, ' ').slice(0, 300), ui: await snap(dialog(), 2500) }
  }, { reset: 'case' })

  await step('gene-lists: create gene list', async () => {
    await openMetaTab('Data Info')
    const b = page.getByRole('button', { name: 'Edit gene list' }).filter({ visible: true })
    if (!(await visible(b, 1500))) notFound('no "Edit gene list" button')
    await smartClick(b)
    await page.waitForTimeout(1200)
    const ed = page.getByRole('dialog').filter({ hasText: 'Create Gene List' })
    await ed.getByRole('textbox', { name: 'List name' }).fill('Parity list')
    await ed.getByRole('textbox', { name: /Genes/ }).fill('BRCA1\nTP53\nNOTAGENE1')
    await page.waitForTimeout(2500)
    const val = (await ed.innerText()).replace(/\s+/g, ' ').slice(0, 250)
    await smartClick(ed.getByRole('button', { name: /^(save|create)/i }).last())
    await page.waitForTimeout(1800)
    return `editor before save: ${val}`
  }, { reset: 'case' })

  await step('region-files: import BED', async () => {
    await page.keyboard.press('Escape')
    await openMetaTab('Data Info')
    const b = page.getByRole('button', { name: 'Import region file' }).filter({ visible: true })
    if (!(await visible(b, 1500))) notFound('no "Import region file" button')
    await smartClick(b)
    await page.waitForTimeout(1200)
    const ed = page.getByRole('dialog').filter({ hasText: 'Import BED Region File' })
    await ed.getByRole('textbox', { name: 'Region file name' }).fill('Parity regions')
    const fc = page.waitForEvent('filechooser', { timeout: 6000 }).catch(() => null)
    await smartClick(ed.getByRole('button', { name: /Select BED file/ }))
    const c = await fc
    if (!c) return { status: 'ERROR', note: 'no file chooser opened' }
    await c.setFiles(ctx.VCF + '/test-regions.bed')
    await page.waitForTimeout(3000)
    const mid = (await ed.innerText()).replace(/\s+/g, ' ').slice(0, 200)
    await smartClick(ed.getByRole('button', { name: 'Import', exact: true }))
    await page.waitForTimeout(2500)
    const after = (await dialog().innerText().catch(() => '')).replace(/\s+/g, ' ')
    const listed = /Parity regions/.test(after)
    return { note: `after select: ${mid} | data tab lists region: ${listed}`, status: listed ? undefined : 'ERROR' }
  }, { reset: 'case' })
}
