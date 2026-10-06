const { chromium } = require('/home/bernt-popp/development/VarLens/node_modules/playwright');
const fs = require('fs'); const path = require('path');
const S = '/tmp/claude-1000/-home-bernt-popp-development-VarLens/4596cad7-5f0b-42ab-955b-cd2473c605c2/scratchpad';
const [,, vpName = 'desktop', BASE = 'http://localhost:8787', tag = 'lat75', scheme = 'light', cpu = '1'] = process.argv;
const VP = vpName === 'desktop' ? { width: 1440, height: 900 } : { width: 390, height: 844 };
const OUT = `${S}/forensics/${tag}-${vpName}-${scheme}`; fs.mkdirSync(OUT + '/frames', { recursive: true });
const cookieVal = fs.readFileSync(S + '/cookie.txt', 'utf8').trim().split('=').slice(1).join('=');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: VP, deviceScaleFactor: 1, colorScheme: scheme, isMobile: vpName !== 'desktop', hasTouch: vpName !== 'desktop' });
  const u = new URL(BASE);
  await ctx.addCookies([{ name: 'varlens.sid', value: cookieVal, domain: u.hostname, path: '/', httpOnly: true, sameSite: 'Strict' }]);
  await ctx.addInitScript(() => { try { localStorage.setItem('varlens_disclaimer_acknowledged_version', '0.72.0') } catch {} });
  await ctx.addInitScript({ path: S + '/instrument.js' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(6000);
  const cdp = await ctx.newCDPSession(page);
  if (cpu !== '1') await cdp.send('Emulation.setCPUThrottlingRate', { rate: +cpu });
  let label = 'load'; let frameIdx = 0; const frameLog = [];
  cdp.on('Page.screencastFrame', async (f) => {
    const fn = `${String(frameIdx++).padStart(4, '0')}-${label}.jpg`;
    fs.writeFileSync(`${OUT}/frames/${fn}`, Buffer.from(f.data, 'base64'));
    frameLog.push({ fn, label, ts: f.metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  const reqs = []; const reqStart = new Map();
  page.on('request', (r) => { reqStart.set(r, Date.now()); });
  page.on('requestfinished', async (r) => {
    const s = await r.sizes().catch(() => ({})); const t = r.timing();
    const resp = await r.response();
    reqs.push({ label: r.__label || label, url: r.url().replace(BASE, ''), method: r.method(), status: resp ? resp.status() : 0, type: r.resourceType(), bodyIn: s.responseBodySize, hdrIn: s.responseHeadersSize, reqBody: (r.postData() || '').length, post: (r.postData() || '').slice(0, 160), dur: t.responseEnd, ttfb: t.responseStart - t.requestStart, enc: resp ? (await resp.allHeaders())['content-encoding'] || '' : '' });
  });
  page.on('request', (r) => { r.__label = label; });
  let pending = 0; page.on('request', (r) => { if (r.url().includes('/api/') && !r.url().includes('/api/events')) pending++; });
  const dec = (r) => { if (r.url().includes('/api/') && !r.url().includes('/api/events')) pending--; };
  page.on('requestfinished', dec); page.on('requestfailed', dec);
  const results = [];
  async function settle(maxMs = 12000, quiet = 700) {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      await page.waitForTimeout(100);
      const lm = await page.evaluate(() => performance.now() - (window.__perf.lastMut || 0));
      if (pending <= 0 && lm > quiet) return;
    }
  }
  async function act(name, fn) {
    label = name;
    await page.evaluate((n) => window.__mark(n), name).catch(() => {});
    const t0wall = Date.now();
    let err = null;
    try { await fn(); } catch (e) { err = e.message.split('\n')[0]; }
    await settle();
    const m = await page.evaluate(() => ({ t0: window.__perf.t0, lastMut: window.__perf.lastMut, lastMutLabel: window.__perf.lastMutLabel })).catch(() => ({}));
    results.push({ name, err, wall: Date.now() - t0wall, dataRendered: (m.lastMutLabel === name && m.lastMut) ? m.lastMut - m.t0 : null });
    await page.screenshot({ path: `${OUT}/${String(results.length).padStart(2, '0')}-${name}.png` });
    console.log(name, err || 'ok', results[results.length - 1].dataRendered);
  }
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 40, maxWidth: vpName === 'desktop' ? 720 : 390, everyNthFrame: 1 });
  const caseVisible = async () => page.getByText('LB26-0060').first().evaluate((e) => { const r = e.getBoundingClientRect(); return r.x >= 0 && r.right <= innerWidth; }).catch(() => false);
  await act('load', async () => { await page.goto(BASE + '/', { waitUntil: 'load' }); await page.waitForSelector('.v-application', { timeout: 15000 }); });
  await act('openCase', async () => {
    if (!(await caseVisible())) { await page.locator('[data-testid=app-sidebar-toggle]').click(); await page.waitForTimeout(400); }
    await page.getByText('LB26-0060').first().click();
  });
  await act('tabSnv', async () => { await page.getByRole('tab', { name: /SNV\/Indel/ }).click(); });
  const th = (t) => page.locator('.v-main thead th').filter({ hasText: new RegExp('^\\s*' + t) }).first();
  await act('sortGeneAsc', async () => { await th('Gene').click({ position: { x: 12, y: 12 } }); });
  await act('sortGeneDesc', async () => { await th('Gene').click({ position: { x: 12, y: 12 } }); });
  await act('nextPage', async () => { await page.getByRole('button', { name: 'Next page' }).click(); });
  await act('prevPage', async () => { await page.getByRole('button', { name: 'Previous page' }).click(); });
  await act('quickFilterOn', async () => { await page.getByText('Rare HIGH', { exact: true }).first().click(); });
  await act('quickFilterOff', async () => { await page.getByText('Rare HIGH', { exact: true }).first().click(); });
  await act('typeSearch', async () => { const i = page.locator('.v-main input[placeholder^="Gene, chr:pos"]').first(); await i.click(); await i.pressSequentially('TTN', { delay: 120 }); await i.press('Enter'); });
  await act('clearSearch', async () => { const i = page.locator('.v-main input[placeholder^="Gene, chr:pos"]').first(); await i.fill(''); await i.press('Enter'); });
  await act('openDetails', async () => { await page.locator('.v-main tbody tr.v-data-table__tr').nth(2).locator('td').nth(6).click(); });
  await act('expandEvidence', async () => { await page.locator('.v-navigation-drawer--right').getByText('Evidence editor').first().click(); });
  await act('openDetails2', async () => { await page.locator('.v-main tbody tr.v-data-table__tr').nth(4).locator('td').nth(6).click({ force: true }); });
  await act('closeDetails', async () => { try { await page.locator('.v-navigation-drawer--right .v-toolbar button:visible').last().click({ timeout: 3000 }); } catch { await page.keyboard.press('Escape'); } });
  await act('toCohort', async () => { await page.getByRole('button', { name: 'Cohort mode' }).click(); });
  await act('cohortSort', async () => { await page.locator('.v-main thead th').nth(3).click({ position: { x: 12, y: 12 } }); });
  await act('cohortNextPage', async () => { await page.getByRole('button', { name: 'Next page' }).first().click(); });
  await act('backToCase', async () => { await page.getByRole('button', { name: 'Case mode' }).click(); });
  fs.writeFileSync(`${OUT}/perf-main.json`, JSON.stringify(await page.evaluate(() => window.__perf)));
  await act('reload', async () => { await page.reload({ waitUntil: 'load' }); await page.waitForSelector('.v-application', { timeout: 15000 }); });
  await cdp.send('Page.stopScreencast').catch(() => {});
  const perf = await page.evaluate(() => window.__perf);
  // reload wipes __perf; merge earlier data captured? capture before reload instead
  fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ results, reqs, frameLog }, null, 1));
  fs.writeFileSync(`${OUT}/perf-after-reload.json`, JSON.stringify(perf));
  await browser.close();
})();
