const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function kind(f) {
  if (f.noRoot) return 'none';
  if (f.noTable) return f.skel > 0 ? 'skeleton' : 'blank';
  if (f.rows > 0) return 'data';
  if (f.loadingRow && f.skel > 0) return 'skeleton';
  if (f.loadingRow) return 'loadtext';
  if (f.noData) return 'empty';
  if (f.skel > 0) return 'skeleton';
  return 'blank';
}
const busyOf = (f) => !!(f.progress || f.lin > 0 || f.tLoading);

function analyze(rec) {
  const fr = rec.frames.filter((f) => f.t != null).map((f) => ({ ...f, t: f.t - rec.t0, k: kind(f) }));
  const pre = fr.filter((f) => f.t < 0);
  const post = fr.filter((f) => f.t >= 0);
  const B = pre[pre.length - 1] || fr[0];
  const F = fr[fr.length - 1];
  const r = { name: rec.name, cond: rec.cond };
  if (!B || !F) return { ...r, error: 'no frames' };
  const visKey = (f) => [f.k, f.sig, busyOf(f) ? 'busy' : '', f.footer, f.op, f.skel].join('§');
  // feedback
  const fb = post.find((f) => visKey(f) !== visKey(B) || f.sort !== B.sort);
  r.feedbackMs = fb ? Math.round(fb.t) : null;
  // data arrival
  if (F.sig !== B.sig || F.k !== B.k) {
    let idx = post.length - 1;
    while (idx > 0 && post[idx - 1].sig === F.sig && post[idx - 1].k === F.k) idx--;
    r.dataMs = Math.round(post[idx].t);
  } else r.dataMs = null; // unchanged data
  // settle: last visible change
  let last = null;
  for (let i = 1; i < post.length; i++) if (visKey(post[i]) !== visKey(post[i - 1]) || post[i].tableH !== post[i - 1].tableH) last = post[i];
  r.settleMs = last ? Math.round(last.t) : null;
  // blank
  let blank = 0;
  const ref = B.k === 'data' || F.k === 'data';
  for (let i = 0; i < post.length; i++) {
    const dt = (post[i + 1] ? post[i + 1].t : post[i].t + 16) - post[i].t;
    if (ref && post[i].k !== 'data' && !(F.k === 'empty' && post[i].k === 'empty')) blank += dt;
  }
  r.blankMs = Math.round(blank);
  // states sequence
  const seq = [];
  let prev = null;
  for (const f of [B, ...post]) {
    const label = f.k + (busyOf(f) ? '+bar' : '') + (f.op && f.op !== '1' ? '+dim' : '');
    const key = label + '|' + f.sig + '|' + f.footer;
    if (key !== prev) { seq.push({ t: Math.round(f.t), label, footer: f.footer, sigShort: (f.sig || '').slice(0, 18) }); prev = key; }
  }
  r.states = seq;
  r.flashes = seq.length - 1;
  // compressed kinds only
  const kinds = []; for (const s of seq) { const l = s.label; if (kinds[kinds.length - 1] !== l) kinds.push(l); }
  r.kindSeq = kinds.join(' > ');
  // height
  const th = post.filter((f) => f.tableH != null);
  r.heightJumpMax = th.length && B.tableH != null ? Math.max(...th.map((f) => Math.abs(f.tableH - B.tableH))) : (B.rootH != null ? Math.max(...post.filter(f=>f.rootH!=null).map((f) => Math.abs(f.rootH - B.rootH))) : null);
  r.heightFinal = F.tableH != null && B.tableH != null ? F.tableH - B.tableH : null;
  r.bodyHRange = th.length ? [Math.min(...th.map((f) => f.bodyH)), Math.max(...th.map((f) => f.bodyH))] : null;
  r.footerMove = post.filter((f) => f.footerTop != null && B.footerTop != null).reduce((m, f) => Math.max(m, Math.abs(f.footerTop - B.footerTop)), 0);
  // columns
  const widths = (s) => (s || '').split(',').map(Number);
  const thSet = new Set(post.map((f) => f.thW).filter(Boolean));
  r.colLayouts = thSet.size;
  const bw = widths(B.thW), fw = widths(F.thW);
  r.colDeltaFinal = bw.length === fw.length ? Math.max(0, ...bw.map((w, i) => Math.abs(w - fw[i]))) : 'n/a(cols ' + bw.length + '→' + fw.length + ')';
  let maxD = 0; for (const f of post) { const w = widths(f.thW); if (w.length === bw.length) maxD = Math.max(maxD, ...w.map((x, i) => Math.abs(x - bw[i]))); }
  r.colDeltaMax = maxD;
  // scroll
  r.scroll = [B.scroll, F.scroll];
  r.scrollMin = Math.min(...post.map((f) => f.scroll ?? 0));
  // footer seq
  const fs_ = []; for (const f of [B, ...post]) if (fs_[fs_.length - 1] !== f.footer) fs_.push(f.footer);
  r.footerSeq = fs_;
  r.focus = [B.focus, F.focus];
  // perf
  r.cls = +rec.ls.filter((e) => !e.rec).reduce((a, e) => a + e.v, 0).toFixed(4);
  r.clsAll = +rec.ls.reduce((a, e) => a + e.v, 0).toFixed(4);
  r.lsSources = [...new Set(rec.ls.filter((e) => !e.rec).flatMap((e) => e.src.map((s) => s.n)))].slice(0, 6);
  const lts = rec.lt.filter((e) => e.t >= rec.t0 - 50);
  r.longTasks = { n: lts.length, total: Math.round(lts.reduce((a, e) => a + e.d, 0)), max: Math.round(Math.max(0, ...lts.map((e) => e.d))) };
  r.inp = Math.round(Math.max(0, ...rec.ev.filter((e) => e.t >= rec.t0 - 50).map((e) => e.d)));
  // network
  const net = rec.net.filter((e) => /\/api\//.test(e.url));
  r.net = net.map((e) => {
    let args = ''; try { args = JSON.stringify(JSON.parse(e.body).args); } catch {}
    return { ep: e.url.replace('/api/', ''), s: Math.round(e.s - rec.t0), e: e.e != null ? Math.round(e.e - rec.t0) : null, args: args.slice(0, 220), abortable: e.signal };
  });
  const dataEps = /variants\/query|cohort\/getVariants|variants\/shortlist/;
  const dataReqs = r.net.filter((n) => dataEps.test(n.ep));
  r.dataReqs = dataReqs.length;
  const seen = {}; let dup = 0; for (const n of dataReqs) { const k = n.ep + n.args; if (seen[k]) dup++; seen[k] = 1; }
  r.dupReqs = dup;
  r.overlapping = dataReqs.filter((a, i) => dataReqs.some((b, j) => j > i && b.s < (a.e ?? 1e9))).length;
  r.apiReqs = r.net.length;
  r.actDur = rec.actDur;
  return r;
}

function filmstrip(rec, a, outDir, base, maxFrames = 10) {
  const tmp = path.join('/tmp/claude-1000/-home-bernt-popp-development-VarLens/4596cad7-5f0b-42ab-955b-cd2473c605c2/scratchpad/table/frames', base);
  fs.mkdirSync(tmp, { recursive: true });
  const preAll = rec.shots.filter((s) => s.t < 0); const shots = [...(preAll.length ? [preAll[preAll.length - 1]] : []), ...rec.shots.filter((s) => s.t >= 0)];
  if (!shots.length) return null;
  // pick: last pre-action frame, then frames nearest to each state transition time, then fill evenly
  const want = new Set();
  const pre = shots.filter((s) => s.t < 0); want.add(pre.length ? shots.indexOf(pre[pre.length - 1]) : 0);
  for (const st of a.states.slice(1)) { const i = shots.findIndex((s) => s.t >= st.t); if (i >= 0) want.add(Math.min(shots.length - 1, i)); }
  want.add(shots.length - 1);
  let idxs = [...want].sort((x, y) => x - y);
  if (idxs.length > maxFrames) { const step = idxs.length / maxFrames; idxs = Array.from({ length: maxFrames }, (_, i) => idxs[Math.floor(i * step)]); idxs[idxs.length - 1] = shots.length - 1; idxs = [...new Set(idxs)]; }
  while (idxs.length < Math.min(6, shots.length)) { const cand = Math.floor(Math.random() * shots.length); if (!idxs.includes(cand)) idxs.push(cand); idxs.sort((x, y) => x - y); }
  const files = idxs.map((i, n) => { const f = path.join(tmp, `${String(n).padStart(2, '0')}.jpg`); fs.writeFileSync(f, Buffer.from(shots[i].data, 'base64')); return { f, t: Math.round(shots[i].t) }; });
  const out = path.join(outDir, `${base}.png`);
  const args = [];
  for (const x of files) args.push('-label', `${x.t < 0 ? 'before' : '+' + x.t + ' ms'}`, x.f);
  args.push('-tile', '4x', '-geometry', '480x300+4+4', '-pointsize', '16', '-title', `${base}  (${a.kindSeq})`, out);
  execFileSync('magick', ['montage', ...args]);
  return out;
}

module.exports = { analyze, filmstrip };
