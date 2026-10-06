// Reproduces the ZIP import flow through the HTTP API (upload -> testZipPassword -> extractZip).
const fs = require('fs')
const path = require('path')
const BASE = 'http://127.0.0.1:8900'
let cookie = ''
async function call(url, body, headers = {}) {
  const res = await fetch(BASE + url, { method: 'POST', headers: { origin: BASE, ...(cookie ? { cookie } : {}), ...headers }, body })
  const sc = res.headers.get('set-cookie')
  if (sc) cookie = sc.split(';')[0]
  return `${res.status} ${(await res.text()).slice(0, 400)}`
}
;(async () => {
  const j = { 'content-type': 'application/json' }
  console.log('login', (await call('/api/auth/login', JSON.stringify({ args: ['admin', (process.env.VARLENS_CRAWL_PASSWORD || '')] }), j)).slice(0, 30))
  const zip = fs.readFileSync(path.join(__dirname, 'parity-import.zip'))
  const up = await call('/api/import/upload', zip, { 'content-type': 'application/octet-stream', 'x-varlens-file-name': 'parity-import.zip' })
  console.log('upload', up)
  const ref = JSON.parse(up.slice(4)).ref
  console.log('testZipPassword', await call('/api/batch-import/testZipPassword', JSON.stringify({ args: [ref, ''] }), j))
  console.log('extractZip', await call('/api/batch-import/extractZip', JSON.stringify({ args: [ref, ''] }), j))
})()
