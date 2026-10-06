// Seed web_dev_track4 with trio cases via the web API (login -> upload -> preview -> start).
import fs from 'node:fs'
const BASE = process.argv[2] ?? 'http://127.0.0.1:8840'
const FILE = process.argv[3]
let cookie = ''
async function rpc(domain, method, args) {
  const r = await fetch(`${BASE}/api/${domain}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, origin: BASE },
    body: JSON.stringify({ args })
  })
  const sc = r.headers.get('set-cookie')
  if (sc) cookie = sc.split(';')[0]
  const t = await r.text()
  return { status: r.status, body: t ? JSON.parse(t) : undefined }
}
const login = await rpc('auth', 'login', ['admin', 'varlens-dev-admin'])
console.log('login', login.status, login.body?.success)
const buf = fs.readFileSync(FILE)
const up = await fetch(`${BASE}/api/import/upload`, {
  method: 'POST',
  headers: {
    'content-type': 'application/octet-stream',
    'x-varlens-file-name': FILE.split('/').pop(), origin: BASE,
    cookie
  },
  body: buf
})
const upBody = await up.json()
console.log('upload', up.status, upBody)
const prev = await rpc('import', 'vcfPreview', [upBody.ref])
console.log('preview', prev.status, JSON.stringify(prev.body).slice(0, 300))
const samples = prev.body?.samples ?? prev.body?.sampleNames ?? []
for (const s of samples.slice(0, 3)) {
  const name = typeof s === 'string' ? s : (s.name ?? s.id)
  const res = await rpc('import', 'start', [upBody.ref, `T4-${name}`, { selectedSample: name, genomeBuild: 'GRCh38' }])
  console.log('import', name, res.status, JSON.stringify(res.body).slice(0, 200))
}
if (samples.length === 0) {
  const res = await rpc('import', 'start', [upBody.ref, 'T4-single', { genomeBuild: 'GRCh38' }])
  console.log('import single', res.status, JSON.stringify(res.body).slice(0, 200))
}
