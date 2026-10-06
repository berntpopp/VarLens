(() => {
  const P = (window.__perf = { label: 'load', shifts: [], lcp: [], longtasks: [], events: [], paints: [], frames: [], mut: [], marks: [] });
  const sel = (n) => {
    if (!n || n.nodeType !== 1) return n ? (n.nodeName || '?') : null;
    const parts = []; let e = n, d = 0;
    while (e && e.nodeType === 1 && d < 5) {
      let s = e.tagName.toLowerCase();
      if (e.id) { s += '#' + e.id; parts.unshift(s); break; }
      const tid = e.getAttribute && e.getAttribute('data-testid'); if (tid) s += `[data-testid=${tid}]`;
      const cls = (e.className && typeof e.className === 'string') ? e.className.split(/\s+/).filter(c => c && !c.startsWith('v-theme--') && !c.includes('density')).slice(0, 3) : [];
      if (cls.length) s += '.' + cls.join('.');
      parts.unshift(s); e = e.parentElement; d++;
    }
    return parts.join(' > ');
  };
  const r = (x) => x ? [Math.round(x.x), Math.round(x.y), Math.round(x.width), Math.round(x.height)] : null;
  const obs = (type, cb, extra) => { try { new PerformanceObserver((l) => l.getEntries().forEach(cb)).observe(Object.assign({ type, buffered: true }, extra || {})); } catch (e) {} };
  obs('layout-shift', (e) => P.shifts.push({ label: P.label, t: e.startTime, v: e.value, hadRecentInput: e.hadRecentInput, sources: (e.sources || []).map((s) => ({ node: sel(s.node), prev: r(s.previousRect), cur: r(s.currentRect) })) }));
  obs('largest-contentful-paint', (e) => P.lcp.push({ label: P.label, t: e.startTime, size: e.size, node: sel(e.element), url: e.url }));
  obs('longtask', (e) => P.longtasks.push({ label: P.label, t: e.startTime, d: e.duration }));
  obs('event', (e) => P.events.push({ label: P.label, name: e.name, t: e.startTime, d: e.duration, inputDelay: e.processingStart - e.startTime, proc: e.processingEnd - e.processingStart, pres: e.startTime + e.duration - e.processingEnd, iid: e.interactionId, target: sel(e.target) }), { durationThreshold: 16 });
  obs('paint', (e) => P.paints.push({ label: P.label, name: e.name, t: e.startTime }));
  window.__mark = (l) => { P.label = l; P.t0 = performance.now(); P.marks.push({ l, t: P.t0 }); };
  // rAF DOM sampler (cheap: counts + bounding of main table only)
  const vis = (q) => { let c = 0; document.querySelectorAll(q).forEach((el) => { if (el.offsetParent !== null || el.getClientRects().length) c++; }); return c; };
  const tick = () => {
    if (document.body) {
      const main = document.querySelector('.v-main');
      const tbl = document.querySelector('.v-main .v-table__wrapper');
      P.frames.push({
        label: P.label, t: performance.now(),
        rows: document.querySelectorAll('.v-main tbody tr.v-data-table__tr').length,
        skel: vis('.v-skeleton-loader'),
        prog: vis('.v-progress-linear, .v-progress-circular'),
        loadRow: document.querySelectorAll('.v-data-table-rows-loading').length,
        noData: document.querySelectorAll('.v-data-table-rows-no-data').length,
        overlay: document.querySelectorAll('.v-overlay--active').length,
        drawers: document.querySelectorAll('.v-navigation-drawer--active').length,
        mainLen: main ? main.textContent.length : -1,
        tblH: tbl ? Math.round(tbl.getBoundingClientRect().height) : -1,
        bg: document.body ? getComputedStyle(document.body).backgroundColor : '',
        app: !!document.querySelector('.v-application')
      });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const mo = new MutationObserver(() => { P.lastMut = performance.now(); P.lastMutLabel = P.label; });
  const startMo = () => mo.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  if (document.documentElement) startMo(); else document.addEventListener('DOMContentLoaded', startMo);
})();
