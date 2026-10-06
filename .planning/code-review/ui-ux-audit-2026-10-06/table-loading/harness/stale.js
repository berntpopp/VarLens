const fs = require('fs');
const path = require('path');
const { setup, measure, waitQuiet, sleep, DIR } = require('./harness');
const { analyze, filmstrip } = require('./analyze');
const OUTDIR = '/home/bernt-popp/development/VarLens/.planning/code-review/ui-ux-audit-2026-10-06/table-loading';
const SNV = '.table-container:has(.variant-table--sticky)';
const CO = '.cohort-table-container';
const SL = '.shortlist-panel';
const vis = (page, css) => page.locator(css).filter({ visible: true }).first();
function armFirstSlow(env, re, slow = 1500) {
  let n = 0;
  env.state.delayFn = (req) => { if (re.test(req.url())) { n++; return n === 1 ? slow : 0; } return 0; };
}
async function snapshot(p, sel) {
  return p.evaluate((sel) => { const r = [...document.querySelectorAll(sel)].find((e) => e.offsetParent); const t = r.querySelector('.v-data-table'); return { footer: t.querySelector('.v-data-table-footer__info')?.textContent.trim(), first: [...t.querySelectorAll('tbody tr')].slice(0, 2).map((x) => x.textContent.replace(/\s+/g, ' ').slice(0, 60)), search: document.querySelector('input[placeholder^="Gene, chr:pos"]')?.value }; }, sel);
}
(async () => {
  const env = await setup({});
  const p = env.page;
  const out = [];
  await p.getByText('LB26-0060').first().click(); await sleep(2500);
  await p.getByRole('tab', { name: /SNV\/Indel/ }).click(); await sleep(1500); await waitQuiet(p);
  const page1 = await snapshot(p, SNV);
  // A: last page (slow) then first page (fast)
  armFirstSlow(env, /variants\/query/);
  let rec = await measure(env, { name: 'stale-snv-page', cond: 'race', sel: SNV, settle: 2500, action: async (pp) => { await vis(pp, SNV).getByRole('button', { name: 'Last page' }).click(); await sleep(250); await vis(pp, SNV).getByRole('button', { name: 'First page' }).click(); } });
  let a = analyze(rec); a.strip = path.basename(filmstrip(rec, a, OUTDIR, 'stale-snv-page__race'));
  a.final = await snapshot(p, SNV); a.expectedFirst = page1.first; a.staleRendered = a.final.first[0] !== page1.first[0]; out.push(a);
  env.state.delayFn = null; await waitQuiet(p);
  // reset to page 1 cleanly
  await vis(p, SNV).getByRole('button', { name: 'First page' }).click().catch(() => {}); await sleep(1000); await waitQuiet(p);
  // B: preset HIGH (slow) then search FLNB (fast)
  armFirstSlow(env, /variants\/query/, 2000);
  rec = await measure(env, { name: 'stale-snv-filter', cond: 'race', sel: SNV, settle: 3500, action: async (pp) => { await pp.locator('.v-chip').filter({ hasText: /^\s*HIGH Impact\s*$/ }).filter({ visible: true }).first().click(); await sleep(450); await vis(pp, 'input[placeholder^="Gene, chr:pos"]').click(); await pp.keyboard.insertText('FLNB'); } });
  a = analyze(rec); a.strip = path.basename(filmstrip(rec, a, OUTDIR, 'stale-snv-filter__race'));
  a.final = await snapshot(p, SNV); out.push(a);
  env.state.delayFn = null; await waitQuiet(p);
  // C: shortlist preset race
  await p.getByRole('tab', { name: /Shortlist/ }).click(); await sleep(1500); await waitQuiet(p);
  armFirstSlow(env, /variants\/shortlist/, 1500);
  rec = await measure(env, { name: 'stale-sl-preset', cond: 'race', sel: SL, settle: 2500, prescroll: 0, action: async (pp) => {
    await vis(pp, '.shortlist-panel .v-select .v-field').click(); await sleep(300); await pp.locator('.v-overlay--active [role=option]').nth(1).click(); await sleep(300);
    await vis(pp, '.shortlist-panel .v-select .v-field').click(); await sleep(300); await pp.locator('.v-overlay--active [role=option]').nth(2).click(); } });
  a = analyze(rec); a.final = await p.evaluate(() => document.querySelector('.shortlist-panel .v-select')?.textContent.trim() + ' | ' + document.querySelector('.shortlist-panel tbody tr')?.textContent.replace(/\s+/g, ' ').slice(0, 60)); out.push(a);
  env.state.delayFn = null; await waitQuiet(p);
  // D: cohort page race
  await p.getByRole('button', { name: /Cohort mode/ }).click(); await sleep(4000); await waitQuiet(p);
  const co1 = await snapshot(p, CO);
  armFirstSlow(env, /cohort\/getVariants/);
  rec = await measure(env, { name: 'stale-co-page', cond: 'race', sel: CO, settle: 2500, action: async (pp) => { await vis(pp, CO).getByRole('button', { name: 'Last page' }).click(); await sleep(250); await vis(pp, CO).getByRole('button', { name: 'First page' }).click(); } });
  a = analyze(rec); a.strip = path.basename(filmstrip(rec, a, OUTDIR, 'stale-co-page__race'));
  a.final = await snapshot(p, CO); a.expectedFirst = co1.first; a.staleRendered = a.final.first[0] !== co1.first[0]; out.push(a);
  for (const x of out) console.log(JSON.stringify({ name: x.name, kindSeq: x.kindSeq, footerSeq: x.footerSeq, states: x.states.map((s) => `${s.t}:${s.label}:${s.footer}:${s.sigShort}`), net: x.net.filter((n) => /query|getVariants|shortlist/.test(n.ep)).map((n) => `${n.ep}@${n.s}-${n.e} ${n.args.slice(0, 90)}`), final: x.final, staleRendered: x.staleRendered, expectedFirst: x.expectedFirst }, null, 1));
  fs.writeFileSync(path.join(DIR, 'out', 'results-stale.json'), JSON.stringify(out, null, 1));
  await env.browser.close();
})();
