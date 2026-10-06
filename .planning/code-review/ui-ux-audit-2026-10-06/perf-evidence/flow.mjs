import fs from 'fs';
import puppeteer from 'puppeteer-core';
import { startFlow } from 'lighthouse';
import desktopConfig from 'lighthouse/core/config/desktop-config.js';
const [,, preset = 'desktop', run = '1', BASE = 'http://localhost:8787', OUTDIR] = process.argv;
const S = '/tmp/claude-1000/-home-bernt-popp-development-VarLens/4596cad7-5f0b-42ab-955b-cd2473c605c2/scratchpad';
const cookieVal = fs.readFileSync(S + '/cookie.txt', 'utf8').trim().split('=').slice(1).join('=');
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-first-run', '--no-default-browser-check'] });
const page = await browser.newPage();
const u = new URL(BASE);
await browser.setCookie({ name: 'varlens.sid', value: cookieVal, domain: u.hostname, path: '/', httpOnly: true, sameSite: 'Strict' });
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('varlens_disclaimer_acknowledged_version', '0.72.0') } catch {} });
const isDesk = preset === 'desktop';
const config = isDesk ? desktopConfig : undefined;
const flags = { disableStorageReset: true };
const flow = await startFlow(page, { config, flags, name: `VarLens web ${preset} run ${run}` });
const idle = () => page.waitForNetworkIdle({ idleTime: 700, concurrency: 1, timeout: 20000 }).catch(() => {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function click(sel) { const h = await page.waitForSelector(sel, { visible: true, timeout: 15000 }); await h.click(); await idle(); await sleep(300); }
await flow.navigate(BASE + '/', { name: 'Home (authenticated, cold load)' });
await idle();
await flow.snapshot({ name: 'Home snapshot (case list, no case selected)' });
await flow.startTimespan({ name: 'Open case LB26-0060 + switch to SNV/Indel tab' });
if (!isDesk) { const vis = await page.evaluate(() => { const e = [...document.querySelectorAll('.v-list-item')].find((x) => x.textContent.includes('LB26-0060')); if (!e) return false; const r = e.getBoundingClientRect(); return r.x >= 0 && r.right <= innerWidth; }); if (!vis) await click('[data-testid=app-sidebar-toggle]'); }
await click('::-p-text(LB26-0060)');
await click('::-p-aria(SNV/Indel 6399[role="tab"])').catch(async () => { await click('.v-tab:nth-child(2)'); });
await flow.endTimespan();
await flow.snapshot({ name: 'Case view snapshot (SNV/Indel table)' });
await flow.startTimespan({ name: 'Case interactions: sort, page, quick filter, search, details panel' });
const geneTh = await page.$$('.v-main thead th');
for (const h of geneTh) { const t = await h.evaluate((e) => e.textContent.trim()); if (t.startsWith('Gene')) { await h.click({ offset: { x: 12, y: 12 } }); await idle(); break; } }
await click('::-p-aria(Next page)');
await click('::-p-text(Rare HIGH)');
await click('::-p-text(Rare HIGH)');
const inp = await page.waitForSelector('.v-main input[placeholder^="Gene, chr:pos"]');
await inp.click(); await inp.type('TTN', { delay: 120 }); await page.keyboard.press('Enter'); await idle(); await sleep(300);
await inp.click({ clickCount: 3 }); await page.keyboard.press('Backspace'); await page.keyboard.press('Enter'); await idle();
const rows = await page.$$('.v-main tbody tr.v-data-table__tr td:nth-child(7)');
if (rows[2]) { await rows[2].click(); await idle(); await sleep(400); }
await click('.v-navigation-drawer--right ::-p-text(Evidence editor)').catch(() => {});
await flow.endTimespan();
await flow.snapshot({ name: 'Case view snapshot with variant details panel open' });
await click('.v-navigation-drawer--right .v-toolbar button').catch(() => {});
await flow.startTimespan({ name: 'Switch to Cohort view + sort + page' });
await click('::-p-aria(Cohort mode)');
await sleep(800);
const cth = await page.$$('.v-main thead th'); if (cth[3]) { await cth[3].click({ offset: { x: 12, y: 12 } }); await idle(); }
await click('::-p-aria(Next page)').catch(() => {});
await flow.endTimespan();
await flow.snapshot({ name: 'Cohort view snapshot' });
const out = OUTDIR || '/home/bernt-popp/development/VarLens/.planning/code-review/ui-ux-audit-2026-10-06/lighthouse';
fs.writeFileSync(`${out}/flow-${preset}-run${run}.report.html`, await flow.generateReport());
fs.writeFileSync(`${out}/flow-${preset}-run${run}.report.json`, JSON.stringify(await flow.createFlowResult()));
await browser.close();
console.log('done', preset, run);
