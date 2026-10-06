// Role-policy probe over HTTP: capability document per role, activity log for
// non-admins, admin-only trail, API docs behind a session, desktop-only 404.
const BASE = process.argv[2] ?? 'http://127.0.0.1:8970'
let ok = 0
let fail = 0
const check = (name, cond, detail) => {
  cond ? ok++ : fail++
  console.log(cond ? 'PASS' : 'FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 200))
}
function session() {
  let cookie = ''
  return async (domain, method, args = []) => {
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
}
const admin = session()
await admin('auth', 'login', ['admin', 'varlens-dev-admin'])
const created = await admin('auth', 'createUser', ['pa-analyst', 'PA Analyst', 'pa-analyst-password-1'])
console.log('createUser', created.status, String(JSON.stringify(created.body)).slice(0, 120))
const adminDoc = (await admin('system', 'getCapabilities')).body
check('admin document grants userAdmin', adminDoc.features.userAdmin.enabled === true)

const user = session()
let login = await user('auth', 'login', ['pa-analyst', 'pa-analyst-password-1'])
if (login.body?.mustChangePassword) {
  await user('auth', 'changePassword', ['pa-analyst-password-1', 'pa-analyst-password-2'])
  login = await user('auth', 'login', ['pa-analyst', 'pa-analyst-password-2'])
}
const userDoc = await user('system', 'getCapabilities')
check('user document: role user, userAdmin off with reason', userDoc.status === 200 && userDoc.body.role !== 'admin' && userDoc.body.features.userAdmin.enabled === false, userDoc.body?.features?.userAdmin)
check('user document blocks auth.listUsers', userDoc.body.blockedMethods.includes('auth.listUsers'))
const byEntity = await user('audit', 'getByEntity', ['chr1:1:A:G'])
check('non-admin audit.getByEntity is allowed (P-16)', byEntity.status === 200, byEntity.status)
const trail = await user('audit', 'query', [{ limit: 5 }])
check('non-admin audit.query stays 403', trail.status === 403, trail.status)
const desktopOnly = await admin('database', 'recentList')
check('desktop-only database.recentList is 404', desktopOnly.status === 404, desktopOnly.status)
const alias = await admin('cohort', 'query', [{}])
check('alias autoroute cohort:query removed (404)', alias.status === 404, alias.status)
const del = await admin('annotations', 'deleteGlobal', ['chr1', 'x', 'A', 'G'])
check('annotations.deleteGlobal validates coordinates (400)', del.status === 400, del.status)
const docs = await fetch(`${BASE}/api/openapi.json`)
check('anonymous /api/openapi.json is 401 (P-21)', docs.status === 401, docs.status)
const csp = (await fetch(`${BASE}/login`)).headers.get('content-security-policy') ?? ''
const shell = await fetch(`${BASE}/`, { redirect: 'manual' })
console.log('shell status', shell.status)
check('CSP header does not allow localhost:60151 by default', !csp.includes('60151'), csp.slice(0, 80))
console.log(`${ok}/${ok + fail} passed`)
process.exit(fail ? 1 : 0)
