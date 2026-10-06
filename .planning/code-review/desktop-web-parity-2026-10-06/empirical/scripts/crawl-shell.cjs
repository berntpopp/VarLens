// App shell: settings menu, panels, preferences, footer, import variants, admin, logout.
// Every step starts from a fresh reload (resetApp) so a stuck dialog cannot cascade.
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

module.exports = async function shellSteps(ctx) {
  const { page, h, snap, closeOverlays, visible, notFound, VCF, BASE, smartClick } = ctx
  const { resetApp } = require('./crawl-lib.cjs')
  const main = () => page.locator('main')
  const dialog = () => page.getByRole('dialog').last()
  const overlay = () => page.locator('.v-overlay--active .v-overlay__content').last()
  const snackText = async () => (await page.locator('.v-snackbar').allInnerTexts().catch(() => [])).join(' ').replace(/\s+/g, ' ').slice(0, 220)
  const step = (name, fn, opts = {}) =>
    h.step(page, name, async () => {
      await resetApp(page, opts.reset ?? 'case')
      return fn()
    }, opts)

  async function openSettingsItem(label) {
    await smartClick(page.getByRole('button', { name: 'Application settings' }))
    await page.waitForTimeout(700)
    const item = page.getByRole('listitem').filter({ hasText: label }).filter({ visible: true }).first()
    if (!(await visible(item, 1500))) notFound(`settings menu item "${label}" missing`)
    await smartClick(item)
    await page.waitForTimeout(2000)
  }

  await step('settings: menu contents', async () => {
    await smartClick(page.getByRole('button', { name: 'Application settings' }))
    await page.waitForTimeout(800)
    const t = (await overlay().innerText()).replace(/\s+/g, ' ')
    return { note: t, ui: await snap(overlay(), 2500) }
  })

  await step('settings: Database Overview', async () => {
    await openSettingsItem('Database Overview')
    await page.waitForTimeout(2000)
    return { note: (await dialog().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 400), ui: await snap(dialog(), 2500) }
  })

  await step('settings: External Links (toggle + save)', async () => {
    await openSettingsItem('External Links')
    const d = dialog()
    const ui = await snap(d, 2500)
    const sw = d.locator('input[type=checkbox]').first()
    if (await visible(sw, 800)) {
      await sw.click({ force: true })
      await page.waitForTimeout(500)
      await sw.click({ force: true })
    }
    const save = d.getByRole('button', { name: /^(save|done|close)$/i })
    if (await visible(save, 800)) await smartClick(save.last())
    await page.waitForTimeout(1000)
    return { note: `toggled first switch twice; snackbar: ${await snackText()}`, ui }
  })

  await step('settings: Custom Tags (create + delete tag)', async () => {
    await openSettingsItem('Custom Tags')
    const d = dialog()
    await smartClick(d.getByRole('button', { name: 'Add Tag' }))
    await page.waitForTimeout(600)
    await d.getByRole('textbox', { name: 'Tag Name' }).fill('parity-crawl-tag2')
    await smartClick(d.getByRole('button', { name: /^(save|create|add)$/i }).last())
    await page.waitForTimeout(1500)
    let note = (await d.innerText()).includes('parity-crawl-tag2') ? 'tag created; ' : 'tag NOT visible after create; '
    const del = d.getByRole('button', { name: 'Delete tag parity-crawl-tag2' })
    if (await visible(del, 1000)) {
      await smartClick(del)
      await page.waitForTimeout(700)
      await smartClick(page.getByRole('button', { name: 'Delete', exact: true }).filter({ visible: true }).last())
      await page.waitForTimeout(1500)
      note += (await d.innerText()).includes('parity-crawl-tag2') ? 'still listed after delete' : 'deleted'
    } else note += 'no delete button'
    return { note, status: /NOT|still/.test(note) ? 'ERROR' : undefined }
  })

  await step('panels: open Gene Panels manager', async () => {
    await openSettingsItem('Gene Panels')
    await page.waitForTimeout(1500)
    return { note: (await dialog().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 400), ui: await snap(dialog(), 3000) }
  })

  await step('panels: New Panel (autocomplete + paste list validate)', async () => {
    await openSettingsItem('Gene Panels')
    await smartClick(page.getByRole('button', { name: 'New Panel' }))
    await page.waitForTimeout(1200)
    const d = page.getByRole('dialog').filter({ hasText: 'Create Panel' })
    await d.getByRole('textbox', { name: 'Panel Name' }).fill('UI parity panel')
    await d.getByRole('combobox', { name: 'Search gene symbol...' }).pressSequentially('TP5', { delay: 30 })
    await page.waitForTimeout(2500)
    const sugg = await overlay().getByRole('option').count().catch(() => 0)
    await page.keyboard.press('Escape')
    await smartClick(d.getByRole('button', { name: 'Paste List' }))
    await page.waitForTimeout(800)
    const pd = page.getByRole('dialog').filter({ hasText: 'Paste Gene List' })
    await pd.getByRole('textbox', { name: 'Gene symbols' }).fill('BRCA1\nTP53')
    await smartClick(pd.getByRole('button', { name: 'Validate & Add' }))
    await page.waitForTimeout(2500)
    const pdText = (await pd.innerText().catch(() => '')).replace(/\s+/g, ' ')
    const saveEnabled = await d.getByRole('button', { name: 'Save' }).isEnabled().catch(() => false)
    return { note: `autocomplete options: ${sugg}; paste dialog: ${pdText.slice(0, 150)}; Save enabled: ${saveEnabled}`, status: saveEnabled ? undefined : 'ERROR' }
  })

  await step('panels: Import PanelApp (search)', async () => {
    await openSettingsItem('Gene Panels')
    await smartClick(page.getByRole('button', { name: 'Import PanelApp' }))
    await page.waitForTimeout(1200)
    const d = page.getByRole('dialog').filter({ hasText: 'Import from PanelApp' })
    const tb = d.getByRole('textbox', { name: 'Search panels...' })
    await tb.fill('epilepsy')
    await tb.press('Enter')
    await page.waitForTimeout(5000)
    const t = (await d.innerText()).replace(/\s+/g, ' ')
    return { note: t.slice(0, 300), status: /Unknown API method|error/i.test(t) ? 'ERROR' : undefined }
  }, { timeout: 40000 })

  await step('panels: StringDB Generate', async () => {
    await openSettingsItem('Gene Panels')
    await smartClick(page.getByRole('button', { name: 'StringDB Generate' }))
    await page.waitForTimeout(1200)
    const d = page.getByRole('dialog').filter({ hasText: 'Generate from StringDB' })
    await d.getByRole('textbox').first().fill('TP53\nMDM2')
    await page.waitForTimeout(500)
    await smartClick(d.getByRole('button', { name: 'Generate' }))
    await page.waitForTimeout(5000)
    const t = (await d.innerText().catch(() => 'closed')).replace(/\s+/g, ' ')
    return { note: t.slice(0, 300), status: /Unknown API method|error/i.test(t) ? 'ERROR' : undefined }
  }, { timeout: 40000 })

  await step('panels: API-created panel row actions (view/export BED)', async () => {
    await openSettingsItem('Gene Panels')
    const d = dialog()
    const row = d.locator('tr').filter({ hasText: 'API parity panel' })
    if (!(await visible(row, 2000))) notFound('API-created panel row not listed')
    const btns = await row.getByRole('button').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') || e.textContent.trim()))
    const exp = row.getByRole('button', { name: /bed|export/i })
    let note = `row buttons: ${btns.join(' | ')}`
    if (await visible(exp, 800)) {
      await smartClick(exp)
      await page.waitForTimeout(1200)
      const ed = dialog()
      const dl = page.waitForEvent('download', { timeout: 8000 }).catch(() => null)
      const go = ed.getByRole('button', { name: /^(export|save|download)/i })
      if (await visible(go, 1000)) await smartClick(go.last())
      const got = await dl
      await page.waitForTimeout(1500)
      note += `; export BED -> ${got ? got.suggestedFilename() : 'no download'}; snackbar: ${await snackText()}`
    }
    return note
  })

  await step('panels: activate panel filter in case view', async () => {
    await smartClick(main().getByRole('button', { name: 'Filters', exact: true }))
    await page.waitForTimeout(900)
    const nav = main().getByRole('navigation', { name: 'Filter options' })
    await smartClick(nav.getByRole('button', { name: 'Gene Panels' }))
    await page.waitForTimeout(1500)
    const ui = await snap(nav, 2500)
    const p = nav.getByText('API parity panel').first()
    if (!(await visible(p, 1500))) return { status: 'NOT-FOUND-IN-UI', note: 'panel not offered in filter group', ui }
    await smartClick(p)
    await page.waitForTimeout(800)
    const opt = overlay().getByText('API parity panel').first()
    if (await visible(opt, 800)) await smartClick(opt)
    await page.waitForTimeout(2500)
    const t = (await main().innerText()).replace(/\s+/g, ' ').match(/([\d,]+) \/ ([\d,]+)/)
    return { note: `after selecting panel: ${t ? t[0] : '?'}`, ui }
  })

  await step('settings: Application Preferences (toggle + save)', async () => {
    await openSettingsItem('Application Preferences')
    const d = dialog()
    const t = (await d.innerText().catch(() => '')).replace(/\s+/g, ' ')
    const ui = await snap(d, 3000)
    const sw = d.locator('input[type=checkbox]').first()
    if (await visible(sw, 800)) {
      await sw.click({ force: true })
      await page.waitForTimeout(400)
      await sw.click({ force: true })
    }
    const save = d.getByRole('button', { name: /^(save|apply|done|close)$/i })
    if (await visible(save, 800)) await smartClick(save.last())
    await page.waitForTimeout(1200)
    return { note: `${t.slice(0, 350)}; snackbar: ${await snackText()}`, ui }
  })

  for (const item of ['Reset Columns', 'Reset Filters']) {
    await step(`settings: ${item}`, async () => {
      await openSettingsItem(item)
      const c = page.getByRole('button', { name: /^(reset|confirm|yes)$/i }).filter({ visible: true })
      if (await visible(c, 800)) await smartClick(c.last())
      await page.waitForTimeout(1000)
      return `clicked; snackbar: ${await snackText()}`
    })
  }

  await step('settings: Delete All Cases dialog (open + cancel)', async () => {
    await openSettingsItem('Delete All Cases')
    const t = (await dialog().innerText().catch(() => '(no dialog)')).replace(/\s+/g, ' ')
    const c = dialog().getByRole('button', { name: /cancel/i })
    if (await visible(c, 800)) await smartClick(c)
    return { note: `dialog: ${t.slice(0, 250)}`, status: /not available|unsupported/i.test(t) ? 'ERROR' : undefined }
  })

  await step('db-picker: VarLens Web menu', async () => {
    await smartClick(page.getByRole('button', { name: /^VarLens Web/ }))
    await page.waitForTimeout(800)
    return { note: (await overlay().innerText().catch(() => '')).replace(/\s+/g, ' '), ui: await snap(overlay(), 1500) }
  })

  await step('db-picker: toolbar "VarLens" title button', async () => {
    const b = page.getByRole('banner').getByRole('button', { name: 'VarLens', exact: true })
    if (!(await b.isVisible().catch(() => false))) return { status: 'OK', note: 'title button present in a11y tree but not visible (hidden element)' }
    await smartClick(b)
    await page.waitForTimeout(1000)
    return (await overlay().innerText().catch(() => '(nothing opened)')).replace(/\s+/g, ' ').slice(0, 200)
  })

  await step('theme toggle: search UI', async () => {
    const t = page.getByRole('button', { name: /theme|dark|light mode/i })
    if (!(await visible(t, 1000))) notFound('no theme toggle button in toolbar/footer')
    await smartClick(t)
    return 'toggled'
  })

  for (const [label, name] of [
    ['footer: version/about', 'VarLens v0.73.0'],
    ['footer: license', 'View license'],
    ['footer: disclaimer', 'View disclaimer'],
    ['footer: FAQ', 'Open FAQ'],
    ['footer: keyboard shortcuts', 'Keyboard shortcuts'],
    ['footer: documentation link', 'Open documentation'],
    ['footer: GitHub link', 'Open GitHub repository']
  ]) {
    await step(label, async () => {
      const before = (h.popups ?? []).length
      await smartClick(page.getByRole('contentinfo').getByRole('button', { name }))
      await page.waitForTimeout(2500)
      const txt = (await page.getByRole('dialog').last().innerText({ timeout: 1000 }).catch(() => '')).replace(/\s+/g, ' ').slice(0, 250)
      const pops = (h.popups ?? []).slice(before)
      return `${txt || '(no dialog)'}${pops.length ? ` popups: ${pops.join(',')}` : ''}`
    })
  }

  await step('logs: log viewer', async () => {
    await smartClick(page.getByRole('contentinfo').getByRole('button', { name: 'Toggle log viewer' }))
    await page.waitForTimeout(2500)
    const lv = page.getByRole('dialog').last()
    const txt = (await lv.innerText({ timeout: 1500 }).catch(() => '')).replace(/\s+/g, ' ')
    return { note: txt.slice(0, 350) || '(no dialog)', ui: await snap(lv, 2000) }
  })

  // --- Import variants ---
  async function openImport() {
    await smartClick(page.getByRole('button', { name: 'Import data' }))
    await page.waitForTimeout(600)
    const it = page.getByText('Import Data', { exact: true }).filter({ visible: true })
    if (await visible(it, 1000)) await smartClick(it)
    await page.waitForTimeout(1000)
    return page.getByRole('dialog').filter({ hasText: 'Import Data' }).last()
  }
  async function waitResult(d, re = /Succeeded|Failed|Error|complete/i, loops = 25) {
    for (let i = 0; i < loops; i++) {
      await page.waitForTimeout(1500)
      if (re.test(await d.innerText().catch(() => ''))) break
    }
    return (await d.innerText().catch(() => '')).replace(/\s+/g, ' ')
  }

  await step('import: single JSON file (demo-case.json)', async () => {
    const d = await openImport()
    const fc = page.waitForEvent('filechooser', { timeout: 8000 })
    await smartClick(d.getByRole('button', { name: /Single File/ }))
    const c = await fc
    await c.setFiles('/home/bernt-popp/development/VarLens/.claude/worktrees/agent-a441a5be6bf38012d/tests/e2e/test-data/demo-case.json')
    await page.waitForTimeout(3500)
    const ui = await snap(d, 2000)
    const go = d.getByRole('button', { name: /^Import/ })
    if (await visible(go, 1500)) await smartClick(go.last())
    const txt = await waitResult(d)
    return { note: txt.slice(0, 300), ui, status: /Failed|Error/i.test(txt) ? 'ERROR' : undefined }
  }, { timeout: 70000, reset: 'none' })

  await step('import: multiple files (SV + STR VCF)', async () => {
    const d = await openImport()
    const fc = page.waitForEvent('filechooser', { timeout: 8000 })
    await smartClick(d.getByRole('button', { name: /Multiple Files/ }))
    const c = await fc
    await c.setFiles([VCF + '/synthetic-sv.vcf', VCF + '/synthetic-str.vcf'])
    await page.waitForTimeout(4000)
    const ui = await snap(page.getByRole('dialog').last(), 2500)
    const dd = page.getByRole('dialog').last()
    const go = dd.getByRole('button', { name: /^(Import|Start)/ })
    if (await visible(go, 1500)) await smartClick(go.last())
    const txt = await waitResult(dd, /Succeeded|Failed|Error|complete|Done/i)
    return { note: txt.slice(0, 350), ui, status: /Failed|Error/i.test(txt) ? 'ERROR' : undefined }
  }, { timeout: 80000, reset: 'none' })

  await step('import: folder (webkitdirectory)', async () => {
    const dir = path.join(__dirname, 'folder-import')
    fs.mkdirSync(dir, { recursive: true })
    fs.copyFileSync(VCF + '/synthetic-cnv.vcf', path.join(dir, 'synthetic-cnv.vcf'))
    const d = await openImport()
    const fc = page.waitForEvent('filechooser', { timeout: 8000 })
    await smartClick(d.getByRole('button', { name: /Folder/ }))
    const c = await fc
    await c.setFiles(dir)
    await page.waitForTimeout(4000)
    const dd = page.getByRole('dialog').last()
    const ui = await snap(dd, 2500)
    const go = dd.getByRole('button', { name: /^(Import|Start)/ })
    if (await visible(go, 1500)) await smartClick(go.last())
    const txt = await waitResult(dd, /Succeeded|Failed|Error|complete|Done/i)
    return { note: txt.slice(0, 350), ui, status: /Failed|Error/i.test(txt) ? 'ERROR' : undefined }
  }, { timeout: 80000, reset: 'none' })

  await step('import: ZIP archive', async () => {
    const zip = path.join(__dirname, 'parity-import.zip')
    if (!fs.existsSync(zip)) execFileSync('zip', ['-j', zip, VCF + '/synthetic-unit-test.vcf'])
    const d = await openImport()
    const fc = page.waitForEvent('filechooser', { timeout: 8000 })
    await smartClick(d.getByRole('button', { name: /ZIP/ }))
    const c = await fc
    await c.setFiles(zip)
    await page.waitForTimeout(5000)
    const dd = page.getByRole('dialog').last()
    const ui = await snap(dd, 2500)
    const go = dd.getByRole('button', { name: /^(Import|Start|Extract)/ })
    if (await visible(go, 1500)) await smartClick(go.last())
    const txt = await waitResult(dd, /Succeeded|Failed|Error|complete|Done/i)
    return { note: txt.slice(0, 350), ui, status: /Failed|Error/i.test(txt) ? 'ERROR' : undefined }
  }, { timeout: 80000, reset: 'none' })

  await step('import: duplicate case name (HG005 again)', async () => {
    const d = await openImport()
    const fc = page.waitForEvent('filechooser', { timeout: 8000 })
    await smartClick(d.getByRole('button', { name: /Single File/ }))
    const c = await fc
    await c.setFiles(VCF + '/single-sample.vep.vcf.gz')
    await page.waitForTimeout(3500)
    const go = d.getByRole('button', { name: /^Import \d+ sample/ })
    if (await visible(go, 1500)) await smartClick(go.last())
    const txt = await waitResult(d)
    const btn = d.getByRole('button', { name: 'HG005', exact: true })
    if (await visible(btn, 800)) await smartClick(btn)
    await page.waitForTimeout(600)
    const detail = (await d.innerText()).replace(/\s+/g, ' ')
    return { note: detail.slice(0, 300), status: /unexpected error/i.test(detail) ? 'ERROR' : undefined }
  }, { timeout: 70000, reset: 'none' })

  await step('jobs: jobs list UI', async () => {
    const j = page.getByRole('button', { name: /jobs|background tasks/i })
    if (!(await visible(j, 1000))) notFound('no jobs/background-task UI found')
    await smartClick(j)
    return 'opened'
  })

  await step('cases: delete a crawl-imported case', async () => {
    const opt = page.getByRole('listbox', { name: 'Cases' }).getByRole('option').filter({ hasText: /synthetic|cnv|str|sv|Demo|unit/i }).first()
    if (!(await visible(opt, 1500))) notFound('no crawl-imported case to delete')
    const label = (await opt.innerText()).replace(/\s+/g, ' ').slice(0, 80)
    await opt.click({ button: 'right' })
    await page.waitForTimeout(800)
    let del = overlay().getByText(/delete/i)
    if (!(await visible(del, 1000))) {
      await opt.hover()
      await page.waitForTimeout(400)
      del = opt.getByRole('button', { name: /delete|more|actions|menu/i })
    }
    if (!(await visible(del, 1000))) notFound(`no delete affordance (context menu / hover) on case "${label}"`)
    await smartClick(del)
    await page.waitForTimeout(800)
    const cbtn = page.getByRole('dialog').last().getByRole('button', { name: /^delete/i })
    if (await visible(cbtn, 1000)) await smartClick(cbtn.last())
    await page.waitForTimeout(2500)
    return `deleted ${label}; snackbar: ${await snackText()}`
  })

  // --- Admin / auth ---
  await step('admin: user management UI', async () => {
    for (const re of [/users/i, /user management/i, /admin/i, /account/i, /profile/i]) {
      const b = page.getByRole('button', { name: re }).filter({ visible: true })
      if (await visible(b, 400)) return `found control matching ${re}`
    }
    const menus = []
    await smartClick(page.getByRole('button', { name: 'Application settings' }))
    await page.waitForTimeout(600)
    menus.push(await overlay().innerText().catch(() => ''))
    await closeOverlays(page)
    await smartClick(page.getByRole('button', { name: /^VarLens Web/ }))
    await page.waitForTimeout(600)
    menus.push(await overlay().innerText().catch(() => ''))
    await closeOverlays(page)
    if (/user|admin|account/i.test(menus.join(' '))) return 'user entry in a menu'
    notFound('no user-management/admin entry in toolbar, settings menu, DB-picker menu or footer')
  })

  await step('auth: logout UI', async () => {
    const b = page.getByRole('button', { name: /log ?out|sign ?out/i }).filter({ visible: true })
    if (await visible(b, 800)) return 'logout button present'
    const menus = []
    await smartClick(page.getByRole('button', { name: /^VarLens Web/ }))
    await page.waitForTimeout(600)
    menus.push(await overlay().innerText().catch(() => ''))
    await closeOverlays(page)
    await smartClick(page.getByRole('button', { name: 'Application settings' }))
    await page.waitForTimeout(600)
    menus.push(await overlay().innerText().catch(() => ''))
    await closeOverlays(page)
    if (/log ?out|sign ?out/i.test(menus.join(' '))) return 'logout entry in a menu'
    notFound('no logout control in toolbar, DB-picker menu, settings menu or footer')
  })

  await step('auth: change password UI', async () => {
    const b = page.getByRole('button', { name: /change password/i }).filter({ visible: true })
    if (!(await visible(b, 800))) notFound('no change-password control visible')
    return 'present'
  })

  await step('auth: logout via API then reload', async () => {
    const r = await page.evaluate(async () => {
      const res = await fetch('/api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include', body: '{"args":[]}' })
      return `${res.status} ${await res.text()}`
    })
    await page.goto(BASE + '/', { waitUntil: 'networkidle' })
    return `logout api: ${r.slice(0, 120)}; after reload at ${page.url().replace(BASE, '')}`
  }, { allowBlank: true, reset: 'none' })

  await h.step(page, 'auth: re-login', async () => {
    if (!/\/login/.test(page.url())) await page.goto(BASE + '/login', { waitUntil: 'networkidle' })
    await page.fill('input[name=username], #username', 'admin')
    await page.fill('input[type=password]', (process.env.VARLENS_CRAWL_PASSWORD || ''))
    await page.keyboard.press('Enter')
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 })
    await page.waitForTimeout(3000)
    const n = await page.getByRole('listbox', { name: 'Cases' }).getByRole('option').count().catch(() => -1)
    return `back at ${page.url().replace(BASE, '')}; ${n} cases listed`
  })

  await step('session: reload keeps selected case? (URL state)', async () => {
    const u1 = page.url()
    const t1 = await page.title()
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(3000)
    return `before reload url ${u1.replace(BASE, '')} title "${t1}"; after reload url ${page.url().replace(BASE, '')} title "${await page.title()}"`
  })
}
