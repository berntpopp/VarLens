const fs=require('fs');
const runs=process.argv.slice(2);
const table={};
for(const D of runs){
 const R=JSON.parse(fs.readFileSync(D+'/results.json'));const P=JSON.parse(fs.readFileSync(D+'/perf-main.json'));
 for(const r of R.results){ if(r.name==='reload'||r.name==='load')continue;
  const m=P.marks.find(x=>x.l===r.name); if(!m)continue; const t0=m.t;
  const fr=P.frames.filter(f=>f.label===r.name);
  const sig=f=>[f.rows,f.loadRow,f.skel,f.tblH,f.mainLen,f.drawers,f.noData].join(',');
  const base=sig(fr[0]||{});let first=null,last=null,prev=base,skelMs=0;
  for(let i=0;i<fr.length;i++){const f=fr[i];const s=sig(f);if(s!==prev){if(first==null)first=f.t-t0;last=f.t-t0;prev=s}
   if(f.loadRow>0&&fr[i+1])skelMs+=fr[i+1].t-f.t;}
  const ev=P.events.filter(e=>e.label===r.name&&e.iid>0);const inp=Math.max(0,...ev.map(e=>e.d));
  const cls=P.shifts.filter(s=>s.label===r.name).reduce((a,s)=>a+s.v,0);
  const rq=R.reqs.filter(q=>q.label===r.name&&q.url.includes('/api/'));
  (table[r.name]=table[r.name]||{})[D.split('/').pop()]={inp:Math.round(inp),first:first&&Math.round(first),settle:last&&Math.round(last),skel:Math.round(skelMs),cls:+cls.toFixed(3),api:rq.length,kb:+(rq.reduce((a,q)=>a+(q.bodyIn||0),0)/1024).toFixed(0)};
 }
}
const keys=runs.map(d=>d.split('/').pop());
console.log('interaction'.padEnd(15),keys.map(k=>k.padEnd(44)).join(''));
for(const[n,v]of Object.entries(table))console.log(n.padEnd(15),keys.map(k=>{const x=v[k];return x?`INP${x.inp} 1st${x.first} set${x.settle} sk${x.skel} cls${x.cls} ${x.api}req/${x.kb}K`.padEnd(44):''.padEnd(44)}).join(''));
