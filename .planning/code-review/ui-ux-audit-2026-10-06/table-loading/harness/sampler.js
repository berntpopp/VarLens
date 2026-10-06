// Injected via addInitScript
(() => {
  const R = (window.__rec = { on: false, sel: null, frames: [], ls: [], lt: [], ev: [], net: [], t0: 0 });
  // fetch wrapper
  const of = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input.url;
    const entry = { url: url.replace(location.origin, ''), s: performance.now(), body: init && typeof init.body === 'string' ? init.body.slice(0, 600) : null, signal: !!(init && init.signal) };
    if (!url.includes('/api/events')) R.net.push(entry);
    return of(input, init).then(
      (r) => { entry.h = performance.now(); entry.status = r.status; const t = r.text.bind(r); r.text = () => t().then((x) => { entry.e = performance.now(); return x; }); return r; },
      (err) => { entry.err = String(err); entry.e = performance.now(); throw err; }
    );
  };
  const desc = (n) => { if (!n || !n.nodeType) return null; if (n.nodeType !== 1) n = n.parentElement; if (!n) return null; let s = n.tagName.toLowerCase(); if (n.id) s += '#' + n.id; const c = (n.className && typeof n.className === 'string') ? n.className.split(/\s+/).filter(Boolean).slice(0, 3).join('.') : ''; if (c) s += '.' + c; return s; };
  try { new PerformanceObserver((l) => { if (!R.on) return; for (const e of l.getEntries()) R.ls.push({ t: e.startTime, v: e.value, rec: e.hadRecentInput, src: (e.sources || []).map((s) => ({ n: desc(s.node), pr: s.previousRect && [Math.round(s.previousRect.y), Math.round(s.previousRect.height)], cr: s.currentRect && [Math.round(s.currentRect.y), Math.round(s.currentRect.height)] })) }); }).observe({ type: 'layout-shift', buffered: false }); } catch {}
  try { new PerformanceObserver((l) => { if (!R.on) return; for (const e of l.getEntries()) R.lt.push({ t: e.startTime, d: e.duration }); }).observe({ type: 'longtask', buffered: false }); } catch {}
  try { new PerformanceObserver((l) => { if (!R.on) return; for (const e of l.getEntries()) if (e.interactionId) R.ev.push({ t: e.startTime, d: e.duration, n: e.name, id: e.interactionId, pd: e.processingStart - e.startTime, pe: e.processingEnd - e.processingStart }); }).observe({ type: 'event', durationThreshold: 16, buffered: false }); } catch {}
  const visible = (el) => el && el.offsetParent !== null;
  function pickRoot() { const all = [...document.querySelectorAll(R.sel)]; return all.find(visible) || null; }
  function sample() {
    if (R.on) {
      const t = performance.now();
      const root = pickRoot();
      const f = { t };
      if (root) {
        const table = [...root.querySelectorAll('.v-data-table')].find(visible) || null;
        const rr = root.getBoundingClientRect();
        f.rootTop = Math.round(rr.top); f.rootH = Math.round(rr.height);
        f.skel = [...root.querySelectorAll('.v-skeleton-loader')].filter(visible).length;
        f.lin = [...root.querySelectorAll('.v-data-table-progress .v-progress-linear, [data-testid=shortlist-loading] .v-progress-linear')].length;
        f.overlay = !!document.querySelector('.v-overlay--active .v-overlay__scrim');
        if (table) {
          const tb = table.querySelector('tbody');
          const trs = tb ? [...tb.children] : [];
          const data = trs.filter((r) => !r.classList.contains('v-data-table-rows-loading') && !r.classList.contains('v-data-table-rows-no-data') && !r.classList.contains('v-data-table__tr--expanded-row') && r.tagName === 'TR' && !r.querySelector('td[colspan]'));
          f.rows = data.length;
          f.loadingRow = trs.some((r) => r.classList.contains('v-data-table-rows-loading'));
          f.noData = trs.some((r) => r.classList.contains('v-data-table-rows-no-data'));
          f.progress = !!table.querySelector('.v-data-table-progress');
          f.tLoading = table.classList.contains('v-data-table--loading');
          f.sig = data.slice(0, 3).map((r) => r.textContent.replace(/\s+/g, ' ').slice(0, 50)).join('|');
          const tr = table.getBoundingClientRect(); f.tableH = Math.round(tr.height); f.tableTop = Math.round(tr.top);
          f.bodyH = tb ? Math.round(tb.getBoundingClientRect().height) : 0;
          f.op = tb ? getComputedStyle(tb).opacity : null;
          const w = table.querySelector('.v-table__wrapper'); f.scroll = w ? w.scrollTop : 0; f.wrapH = w ? Math.round(w.getBoundingClientRect().height) : 0;
          const ths = [...table.querySelectorAll('thead tr:first-child th')];
          f.thW = ths.map((th) => Math.round(th.getBoundingClientRect().width)).join(',');
          f.sort = ths.map((th) => th.getAttribute('aria-sort') || (th.querySelector('.sort-indicator') ? 'S' : '')).join(',') + '|' + [...table.querySelectorAll('thead .sort-indicator')].map((e) => e.textContent.trim() + e.innerHTML.length).join(',');
          const fi = table.querySelector('.v-data-table-footer__info'); f.footer = fi ? fi.textContent.trim() : null;
          const fh = table.querySelector('.v-data-table-footer'); f.footerTop = fh ? Math.round(fh.getBoundingClientRect().top) : null;
          f.busy = table.getAttribute('aria-busy') || root.getAttribute('aria-busy');
        } else { f.rows = 0; f.noTable = true; f.sig = ''; }
      } else f.noRoot = true;
      f.docScroll = Math.round(document.scrollingElement.scrollTop);
      f.focus = desc(document.activeElement);
      R.frames.push(f);
    }
    requestAnimationFrame(sample);
  }
  requestAnimationFrame(sample);
})();
