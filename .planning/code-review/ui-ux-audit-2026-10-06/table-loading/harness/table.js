const C = ['d0','d300','d1000','cpu4'];
const R = Object.fromEntries(C.map(c => [c, require(`./out/results-${c}.json`)]));
const names = R.d300.map(x => x.name);
const g = (c, n) => R[c].find(x => x.name === n) || {};
const v = (x) => x == null ? '–' : x;
const rows = [];
for (const n of names) {
  const a = g('d300', n), z = g('d0', n), k = g('d1000', n), u = g('cpu4', n);
  if (a.error) { rows.push(`| ${n} | error |`); continue; }
  const tdata = (o) => { if (!o.states) return null; const b = o.states[0]; const f = o.states.find((x) => x.t >= 0 && /^(data|empty)/.test(x.label) && (x.sigShort !== b.sigShort || (b.label.startsWith("data") !== x.label.startsWith("data")))); return f ? f.t : (o.dataMs ?? null); };
  const clsMax = Math.max(...C.map(c => g(c, n).cls || 0));
  const colMax = Math.max(...C.map(c => g(c, n).colDeltaMax || 0));
  const scrollReset = a.scroll && a.scroll[0] > 0 && a.scroll[1] === 0;
  const stale = /^(snv|co)-(next|prev|last|first|ipp|sort|search|zero|back|preset|clear)/.test(n);
  let s = 10;
  if (a.blankMs >= 150) s -= 3; if (a.blankMs > 500) s -= 1;
  if (colMax > 40) s -= 1;
  if (scrollReset && !/sort|preset|search|zero|clear|back/.test(n)) s -= 0.5;
  if (clsMax > 0.01) s -= 1;
  if ((a.dupReqs||0) > 0) s -= 1;
  if (stale) s -= 1;
  if ((a.feedbackMs ?? 0) > 300 || a.feedbackMs == null && /search|zero|preset/.test(n)) s -= 1;
  if ((u.inp||0) > 200) s -= 0.5;
  if (a.footerSeq && a.footerSeq.some(f => !f || /NaN|0-0 of 0/.test(f)) && !/zero$/.test(n)) s -= 1;
  if (/^co-(search|zero|back)/.test(n)) s = Math.min(s, 2);
  s = Math.max(0, Math.round(s * 2) / 2);
  rows.push(`| ${n} | ${v(z.feedbackMs)} / ${v(a.feedbackMs)} | ${v(tdata(z))} / ${v(tdata(a))} / ${v(tdata(k))} | ${z.blankMs} / ${a.blankMs} / ${k.blankMs} | ${a.flashes} (${a.kindSeq}) | ${a.heightJumpMax ?? '–'} / body ${a.bodyHRange ? a.bodyHRange.join('–') : '–'} | ${clsMax} | ${colMax} | ${a.scroll ? a.scroll.join('→') : '–'} | ${a.dataReqs}${a.dupReqs ? ' (dup ' + a.dupReqs + ')' : ''} | ${z.inp} / ${u.inp} | ${(a.footerSeq||[]).map(f => f ?? '∅').join(' → ')} | **${s}** |`);
}
console.log('| Interaction | Feedback ms (d0/d300) | First new rows ms (d0/d300/d1000) | Blank body ms (d0/d300/d1000) | Flashes (d300 sequence) | Outer jump px / tbody px | CLS max | Col jitter px | Scroll before→after | Data reqs (d300) | INP ms (d0/cpu4) | Footer sequence (d300) | Score |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
console.log(rows.join('\n'));
