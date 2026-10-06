const fs = require('fs');
const path = require('path');
const { setup, measure, waitQuiet, sleep, DIR } = require('./harness');
const { analyze, filmstrip } = require('./analyze');
const OUTDIR = '/home/bernt-popp/development/VarLens/.planning/code-review/ui-ux-audit-2026-10-06/table-loading';
const cond = process.argv[2] || 'd0';
const only = process.argv[3] ? process.argv[3].split(',') : null;
const cfg = { d0: { delay: 0, cpu: 1, settle: 1800 }, d300: { delay: 300, cpu: 1, settle: 2300 }, d1000: { delay: 1000, cpu: 1, settle: 3300 }, cpu4: { delay: 0, cpu: 4, settle: 2600 } }[cond];
const STRIP_ALL = cond === 'd300';
const STRIP_KEY = new Set(['snv-next', 'snv-sort-gene-asc', 'snv-preset-high', 'snv-search-slow', 'snv-zero', 'snv-back-from-zero', 'sl-refresh', 'co-next', 'co-preset-high', 'co-search-slow']);

const SNV = '.table-container:has(.variant-table--sticky)';
const SL = '.shortlist-panel';
const CO = '.cohort-table-container';
const vis = (page, css) => page.locator(css).filter({ visible: true }).first();
const root = (page, sel) => vis(page, sel);
const search = (page) => vis(page, 'input[placeholder^="Gene, chr:pos"]');
const header = (page, sel, title) => root(page, sel).locator('.sortable-header').filter({ has: page.locator('.header-title', { hasText: new RegExp('^\\s*' + title + '\\s*$') }) }).first();
const chip = (page, text) => page.locator('.v-chip').filter({ hasText: new RegExp('^\\s*' + text.replace(/[()/+]/g, (m) => '\\' + m) + '\\s*$') }).filter({ visible: true }).first();
async function openIpp(page, sel) { await root(page, sel).locator('.v-data-table-footer__items-per-page .v-field').click(); await sleep(400); }
async function clearSearch(page) { const s = search(page); await s.click(); await page.keyboard.press('Control+A'); await page.keyboard.press('Backspace'); }

const SNV_STEPS = [
  { name: 'snv-tab-in', sel: SNV, action: (p) => p.getByRole('tab', { name: /SNV\/Indel/ }).click(), prescroll: 0 },
  { name: 'snv-next', sel: SNV, action: (p) => root(p, SNV).getByRole('button', { name: 'Next page' }).click() },
  { name: 'snv-next2', sel: SNV, action: (p) => root(p, SNV).getByRole('button', { name: 'Next page' }).click() },
  { name: 'snv-prev', sel: SNV, action: (p) => root(p, SNV).getByRole('button', { name: 'Previous page' }).click() },
  { name: 'snv-last', sel: SNV, action: (p) => root(p, SNV).getByRole('button', { name: 'Last page' }).click() },
  { name: 'snv-first', sel: SNV, action: (p) => root(p, SNV).getByRole('button', { name: 'First page' }).click() },
  { name: 'snv-ipp50', sel: SNV, pre: (p) => openIpp(p, SNV), action: (p) => p.getByRole('option', { name: '50', exact: true }).filter({ visible: true }).click() },
  { name: 'snv-sort-gene-asc', sel: SNV, action: (p) => header(p, SNV, 'Gene').click() },
  { name: 'snv-sort-gene-desc', sel: SNV, action: (p) => header(p, SNV, 'Gene').click() },
  { name: 'snv-sort-pos-2nd', sel: SNV, action: (p) => header(p, SNV, 'Position').click() },
  { name: 'snv-search-slow', sel: SNV, pre: (p) => search(p).click(), action: (p) => p.keyboard.type('FLNB', { delay: 180 }), extra: 800 },
  { name: 'snv-search-clear', sel: SNV, action: (p) => clearSearch(p) },
  { name: 'snv-search-paste', sel: SNV, pre: (p) => search(p).click(), action: (p) => p.keyboard.insertText('COL15A1') },
  { name: 'snv-search-clear2', sel: SNV, action: (p) => clearSearch(p) },
  { name: 'snv-zero', sel: SNV, pre: (p) => search(p).click(), action: (p) => p.keyboard.insertText('ZZZNOTAGENE') },
  { name: 'snv-back-from-zero', sel: SNV, action: (p) => clearSearch(p) },
  { name: 'snv-preset-high', sel: SNV, action: (p) => chip(p, 'HIGH Impact').click() },
  { name: 'snv-preset-clinvar', sel: SNV, action: (p) => chip(p, 'ClinVar P/LP').click() },
  { name: 'snv-clear-filters', sel: SNV, action: (p) => vis(p, 'button:has-text("Clear")').click() },
  { name: 'snv-row-open', sel: SNV, prescroll: 0, action: (p) => root(p, SNV).locator('tbody tr').nth(2).locator('td').nth(6).click() },
  { name: 'snv-row-close', sel: SNV, prescroll: 0, action: (p) => p.keyboard.press('Escape') },
  { name: 'snv-tab-out', sel: SL, prescroll: 0, action: (p) => p.getByRole('tab', { name: /Shortlist/ }).click() }
];
const SL_STEPS = [
  { name: 'sl-preset-change', sel: SL, prescroll: 0, pre: async (p) => { await vis(p, '.shortlist-panel .v-select .v-field').click(); await sleep(400); }, action: (p) => p.locator('.v-overlay--active [role=option]').nth(1).click() },
  { name: 'sl-refresh', sel: SL, action: (p) => vis(p, '.shortlist-panel button:has-text("Refresh")').click() },
  { name: 'sl-ipp25', sel: SL, pre: (p) => openIpp(p, SL), action: (p) => p.getByRole('option', { name: '25', exact: true }).filter({ visible: true }).click() },
  { name: 'sl-next', sel: SL, action: (p) => root(p, SL).getByRole('button', { name: 'Next page' }).click() }
];
const CO_STEPS = [
  { name: 'co-enter', sel: CO, prescroll: 0, action: (p) => p.getByRole('button', { name: /Cohort mode/ }).click(), extra: 1500 },
  { name: 'co-next', sel: CO, action: (p) => root(p, CO).getByRole('button', { name: 'Next page' }).click() },
  { name: 'co-next2', sel: CO, action: (p) => root(p, CO).getByRole('button', { name: 'Next page' }).click() },
  { name: 'co-prev', sel: CO, action: (p) => root(p, CO).getByRole('button', { name: 'Previous page' }).click() },
  { name: 'co-last', sel: CO, action: (p) => root(p, CO).getByRole('button', { name: 'Last page' }).click() },
  { name: 'co-first', sel: CO, action: (p) => root(p, CO).getByRole('button', { name: 'First page' }).click() },
  { name: 'co-ipp25', sel: CO, pre: (p) => openIpp(p, CO), action: (p) => p.getByRole('option', { name: '25', exact: true }).filter({ visible: true }).click() },
  { name: 'co-sort-gene-asc', sel: CO, action: (p) => header(p, CO, 'Gene').click() },
  { name: 'co-sort-gene-desc', sel: CO, action: (p) => header(p, CO, 'Gene').click() },
  { name: 'co-sort-pos-2nd', sel: CO, action: (p) => header(p, CO, 'Position').click() },
  { name: 'co-search-slow', sel: CO, pre: (p) => search(p).click(), action: (p) => p.keyboard.type('MUC5', { delay: 180 }), extra: 800 },
  { name: 'co-search-clear', sel: CO, action: (p) => clearSearch(p) },
  { name: 'co-zero', sel: CO, pre: (p) => search(p).click(), action: (p) => p.keyboard.insertText('ZZZNOTAGENE') },
  { name: 'co-back-from-zero', sel: CO, action: (p) => clearSearch(p) },
  { name: 'co-preset-high', sel: CO, action: (p) => chip(p, 'HIGH Impact').click() },
  { name: 'co-clear-filters', sel: CO, action: (p) => vis(p, '.cohort-table-container button:has-text("Clear")').click() },
  { name: 'co-row-expand', sel: CO, prescroll: 0, action: (p) => root(p, CO).locator('tbody tr').first().locator('button').first().click() },
  { name: 'co-row-open', sel: CO, prescroll: 0, action: (p) => root(p, CO).locator('tbody tr.v-data-table__tr').nth(3).locator('td').nth(7).click() },
  { name: 'co-row-close', sel: CO, prescroll: 0, action: (p) => p.keyboard.press('Escape') }
];

(async () => {
  const env = await setup(cfg);
  const results = [];
  const runSteps = async (steps) => {
    for (const st of steps) {
      if (only && !only.some((o) => st.name.startsWith(o))) continue;
      try {
        await waitQuiet(env.page);
        if (st.pre) { await st.pre(env.page); }
        const rec = await measure(env, { name: st.name, cond, sel: st.sel, action: st.action, settle: cfg.settle + (st.extra || 0), prescroll: st.prescroll ?? 200 });
        const a = analyze(rec);
        if (STRIP_ALL || STRIP_KEY.has(st.name)) { try { a.strip = path.basename(filmstrip(rec, a, OUTDIR, `${st.name}__${cond}`)); } catch (e) { a.stripErr = String(e).slice(0, 200); } }
        results.push(a);
        console.log(`${cond} ${st.name}: fb=${a.feedbackMs} data=${a.dataMs} blank=${a.blankMs} flashes=${a.flashes} h=${a.heightJumpMax} cols=${a.colLayouts}/${a.colDeltaMax} scroll=${a.scroll} req=${a.dataReqs} dup=${a.dupReqs} cls=${a.cls} inp=${a.inp} lt=${a.longTasks.n}/${a.longTasks.total} | ${a.kindSeq} | ${a.footerSeq.join(' > ')}`);
      } catch (e) { console.log(`${cond} ${st.name}: ERROR ${String(e).split('\n')[0]}`); results.push({ name: st.name, cond, error: String(e).slice(0, 300) }); }
    }
  };
  await env.page.getByText('LB26-0060').first().click();
  await sleep(2500);
  await waitQuiet(env.page);
  await runSteps(SNV_STEPS);
  await runSteps(SL_STEPS);
  await runSteps(CO_STEPS);
  fs.writeFileSync(path.join(DIR, 'out', `results-${cond}${only ? '-partial' : ''}.json`), JSON.stringify(results, null, 1));
  await env.browser.close();
})();
