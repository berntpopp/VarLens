const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const DIR = '/tmp/claude-1000/-home-bernt-popp-development-VarLens/4596cad7-5f0b-42ab-955b-cd2473c605c2/scratchpad/table';
const SAMPLER = fs.readFileSync(path.join(DIR, 'sampler.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setup({ delay = 0, cpu = 1 } = {}) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await context.addInitScript(SAMPLER);
  const page = await context.newPage();
  const state = { delay, delayFn: null };
  await page.route(/\/api\/(variants|cohort|annotations)\//, async (route) => {
    const d = state.delayFn ? state.delayFn(route.request()) : state.delay;
    if (d > 0) await sleep(d);
    try { await route.continue(); } catch {}
  });
  const cdp = await context.newCDPSession(page);
  const shots = { on: false, list: [] };
  cdp.on('Page.screencastFrame', async (f) => {
    try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch {}
    if (shots.on) shots.list.push({ ts: f.metadata.timestamp * 1000, data: f.data });
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 55, maxWidth: 800, maxHeight: 500, everyNthFrame: 1 });
  // login
  await page.goto('http://localhost:8787/');
  await page.waitForSelector('#login-form input', { timeout: 20000 });
  const inputs = page.locator('#login-form input');
  await inputs.nth(0).fill('admin');
  await inputs.nth(1).fill('varlens-dev-admin');
  await page.click('#submit');
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), null, { timeout: 20000 });
  try { const b = page.getByRole('button', { name: /I Understand/ }); await b.waitFor({ timeout: 8000 }); await b.click(); } catch {}
  if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  const timeOrigin = await page.evaluate(() => performance.timeOrigin);
  return { browser, context, page, cdp, shots, state, timeOrigin };
}

async function waitQuiet(page, ms = 400, max = 8000) {
  const start = Date.now();
  let quietSince = null;
  while (Date.now() - start < max) {
    const busy = await page.evaluate(() => window.__rec.net.some((e) => e.e === undefined && !e.err) || !!document.querySelector('.v-data-table--loading, [data-testid=shortlist-loading]'));
    if (!busy) { if (quietSince === null) quietSince = Date.now(); if (Date.now() - quietSince >= ms) return; } else quietSince = null;
    await sleep(50);
  }
}

async function measure(env, { name, cond, sel, action, settle = 2000, prescroll = 200 }) {
  const { page, shots, timeOrigin } = env;
  await waitQuiet(page);
  await page.evaluate(({ sel, prescroll }) => {
    const R = window.__rec; R.sel = sel;
    const root = [...document.querySelectorAll(sel)].find((e) => e.offsetParent !== null);
    const w = root && [...root.querySelectorAll('.v-table__wrapper')].find((e) => e.offsetParent !== null);
    if (w && prescroll) w.scrollTop = prescroll;
    R.frames = []; R.ls = []; R.lt = []; R.ev = []; R.netMark = R.net.length; R.on = true;
  }, { sel, prescroll });
  shots.list = []; shots.on = true;
  await sleep(200);
  const t0 = await page.evaluate(() => (window.__rec.t0 = performance.now()));
  const actStart = Date.now();
  await action(page);
  const actDur = Date.now() - actStart;
  await sleep(settle);
  shots.on = false;
  const rec = await page.evaluate(() => { const R = window.__rec; R.on = false; return { frames: R.frames, ls: R.ls, lt: R.lt, ev: R.ev, net: R.net.slice(R.netMark), t0: R.t0 }; });
  rec.shots = shots.list.map((s) => ({ t: s.ts - timeOrigin - t0, data: s.data }));
  rec.name = name; rec.cond = cond; rec.actDur = actDur;
  return rec;
}

module.exports = { setup, measure, waitQuiet, sleep, DIR };
