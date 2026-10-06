// Seed the P-D web instance: analyst + viewer accounts and one imported case.
import { readFileSync } from 'node:fs'

const BASE = 'http://127.0.0.1:9000'
const ORIGIN = { origin: BASE }
const VCF = process.argv[2] ?? 'tests/test-data/vcf/synthetic-unit-test.vcf'

async function call(cookie, domain, method, ...args) {
  const res = await fetch(`${BASE}/api/${domain}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookie ?? '', ...ORIGIN },
    body: JSON.stringify({ args })
  })
  const text = await res.text()
  const setCookie = res.headers.get('set-cookie')
  return { status: res.status, body: text ? JSON.parse(text) : undefined, setCookie }
}

async function login(username, password) {
  const res = await call(null, 'auth', 'login', username, password)
  const cookie = res.setCookie?.split(';')[0]
  return { ...res, cookie }
}

const admin = await login('admin', 'varlens-dev-admin')
console.log('admin login', admin.status, admin.body?.mustChangePassword)
for (const [user, role] of [['ana', 'analyst'], ['vic', 'viewer']]) {
  const created = await call(admin.cookie, 'auth', 'createUser', user, user, 'temporary-pass-123', role)
  console.log('create', user, created.status, JSON.stringify(created.body ?? ''))
  const first = await login(user, 'temporary-pass-123')
  if (first.status === 200 && first.body?.mustChangePassword) {
    const changed = await call(first.cookie, 'auth', 'changePassword', 'temporary-pass-123', `${user}-final-password-1`)
    console.log('rotate', user, changed.status)
  }
}
const ghost = await call(admin.cookie, 'auth', 'resetPassword', 'no-such-user', 'whatever-password-1')
const real = await call(admin.cookie, 'auth', 'resetPassword', 'vic', 'vic-final-password-1')
console.log('reset ghost', ghost.status, JSON.stringify(ghost.body), '| reset real', real.status, JSON.stringify(real.body))
// The real reset forces a rotation for vic again; rotate back.
const vic = await login('vic', 'vic-final-password-1')
if (vic.body?.mustChangePassword) {
  const r = await call(vic.cookie, 'auth', 'changePassword', 'vic-final-password-1', 'vic-final-password-2')
  console.log('rotate vic again', r.status)
}

const cases = await call(admin.cookie, 'cases', 'list')
if (!Array.isArray(cases.body) || cases.body.length === 0) {
  const up = await fetch(`${BASE}/api/import/upload`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', 'x-varlens-file-name': 'parity-d.vcf', cookie: admin.cookie, ...ORIGIN },
    body: readFileSync(VCF)
  })
  const { ref } = await up.json()
  const imported = await call(admin.cookie, 'import', 'start', ref, 'Parity D Case', { genomeBuild: 'hg38' })
  console.log('import', imported.status, JSON.stringify(imported.body).slice(0, 200))
} else {
  console.log('cases present', cases.body.length)
}
