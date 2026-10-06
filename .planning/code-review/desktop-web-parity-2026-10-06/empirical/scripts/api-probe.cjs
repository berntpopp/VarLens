// Authenticated probe of the web server's HTTP surface (port 8900).
// Read-only methods are invoked with realistic args; unknown/destructive ones are
// either probed with harmless args or skipped (documented in the output).
const fs = require('fs')
const path = require('path')
const BASE = 'http://127.0.0.1:8900'
const ORIGIN = { origin: BASE }
const surface = JSON.parse(fs.readFileSync(path.join(__dirname, 'api-surface.json'), 'utf8'))

let cookie = ''
async function raw(method, url, body, extraHeaders = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...ORIGIN, ...(cookie ? { cookie } : {}), ...extraHeaders },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: 'manual'
  })
  const sc = res.headers.get('set-cookie')
  if (sc) cookie = sc.split(';')[0]
  const text = await res.text()
  return { status: res.status, ctype: res.headers.get('content-type'), text }
}
const rpc = (domainPath, method, args) => raw('POST', `/api/${domainPath}/${method}`, { args })

// Destructive or side-effecting methods that are never invoked by this probe.
const SKIP = new Set([
  'cases:deleteAll', 'cases:deleteBatch', 'cases:delete', 'database:deleteFile', 'database:rekey', 'database:create',
  'database:open', 'database:postgresProfileRemove', 'database:postgresProfileSave', 'database:removeRecent',
  'gene-ref:update', 
  'perf:resetSnapshot', 'debug:queryCountersReset',
  'import:start', 'import:startMultiFile', 'batch-import:start', 'batch-import:extractZip', 'batch-import:cleanupZipTemp',
  'auth:logout', 'auth:createUser', 'auth:deactivateUser', 'auth:resetPassword', 'auth:changePassword', 'auth:login',
  'database:postgresProfileOpen', 'panels:importPanelApp', 'panels:generateStringDb'
])

;(async () => {
  const out = { generatedAt: new Date().toISOString(), base: BASE, http: [], rpc: [], admin: [] }
  // Public / infra endpoints
  for (const [m, u] of [['GET', '/healthz'], ['GET', '/livez'], ['GET', '/readyz'], ['GET', '/robots.txt'], ['GET', '/login'], ['GET', '/api/openapi.json'], ['GET', '/api/docs'], ['GET', '/'], ['GET', '/case'], ['GET', '/cohort'], ['GET', '/settings']]) {
    const r = await raw(m, u)
    out.http.push({ auth: false, method: m, url: u, status: r.status, ctype: r.ctype, excerpt: r.text.slice(0, 160) })
  }
  const unauth = await rpc('cases', 'list', [])
  out.http.push({ auth: false, method: 'POST', url: '/api/cases/list', status: unauth.status, excerpt: unauth.text.slice(0, 160) })
  const noOrigin = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ args: ['admin', (process.env.VARLENS_CRAWL_PASSWORD || '')] }) })
  out.http.push({ auth: false, method: 'POST', url: '/api/auth/login (no Origin header)', status: noOrigin.status, excerpt: (await noOrigin.text()).slice(0, 160) })

  const login = await rpc('auth', 'login', ['admin', (process.env.VARLENS_CRAWL_PASSWORD || '')])
  out.http.push({ auth: false, method: 'POST', url: '/api/auth/login', status: login.status, excerpt: login.text.slice(0, 200) })
  if (!cookie) throw new Error('login did not set cookie: ' + login.text)

  for (const [m, u] of [['GET', '/api/openapi.json'], ['GET', '/api/docs'], ['GET', '/api/events'], ['GET', '/']]) {
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 1500)
    try {
      const res = await fetch(BASE + u, { method: m, headers: { ...ORIGIN, cookie }, signal: ac.signal, redirect: 'manual' })
      const t = u === '/api/events' ? '(stream)' : await res.text()
      out.http.push({ auth: true, method: m, url: u, status: res.status, ctype: res.headers.get('content-type'), excerpt: t.slice(0, 120) })
      if (u === '/api/openapi.json' && res.status === 200) {
        const spec = JSON.parse(t)
        out.openapiPaths = Object.keys(spec.paths ?? {})
      }
    } catch (e) {
      out.http.push({ auth: true, method: m, url: u, status: 'aborted-after-1.5s (stream open)', excerpt: String(e.message).slice(0, 80) })
    }
  }

  // Fixture data for args
  const cases = JSON.parse((await rpc('cases', 'list', [])).text)
  const caseList = Array.isArray(cases) ? cases : cases.cases ?? cases.data ?? []
  const c0 = caseList.find((c) => /HG006/.test(c.name ?? '')) ?? caseList[0]
  const caseId = c0?.id
  const vq = JSON.parse((await rpc('variants', 'query', [caseId, {}, 0, 5])).text)
  const rows = vq.variants ?? vq.rows ?? vq.data ?? []
  const v = rows[0] ?? {}
  out.fixture = { caseId, caseName: c0?.name, variantKeys: Object.keys(v).slice(0, 40), variant: { id: v.id, chr: v.chr, pos: v.pos, ref: v.ref, alt: v.alt, gene: v.gene_symbol ?? v.gene } }
  const { chr, pos, ref, alt } = v
  const gene = v.gene_symbol ?? v.gene ?? 'TP53'

  const ARGS = {
    'cases:list': [], 'cases:query': [{ offset: 0, limit: 10 }], 'cases:availableBuilds': [],
    'variants:query': [caseId, {}, 0, 5], 'variants:getFilterOptions': [caseId], 'variants:search': [caseId, gene, 5],
    'variants:geneSymbols': [caseId, gene.slice(0, 3), 5], 'variants:typeCounts': [caseId], 'variants:columnMeta': [{ caseId }],
    'variants:typesPresent': [{ caseId }], 'variants:shortlist': [caseId, {}],
    'import:vcfPreview': ['nonexistent-ref'], 'import:vcfMultiPreview': [['nonexistent-ref']], 'import:cancel': [],
    'export:variants': [{ caseId, format: 'csv', filters: {} }], 'export:cohort': [{ format: 'csv', filters: {} }],
    'database:info': [], 'database:capabilities': [], 'database:recentList': [], 'database:getOverview': [],
    'database:postgresDiagnostics': [], 'database:postgresProfilesList': [], 'database:postgresProfileTest': [{}],
    'database:selectFile': [], 'database:selectSaveLocation': ['x.db'], 'database:showInFolder': ['/nonexistent'],
    'batch-import:checkDuplicates': [[]], 'batch-import:cancel': [], 'batch-import:testZipPassword': ['nonexistent-ref', ''],
    'cohort:getVariants': [{ offset: 0, limit: 5, filters: {} }], 'cohort:getColumnMeta': [], 'cohort:getSummary': [],
    'cohort:getCarriers': [chr, pos, ref, alt], 'cohort:getGeneBurden': [], 'cohort:getSummaryStatus': [], 'cohort:cancelAssociation': [],
    'annotations:getGlobal': [chr, pos, ref, alt], 'annotations:getPerCase': [caseId, v.id], 'annotations:getForVariant': [caseId, chr, pos, ref, alt],
    'annotations:batchGet': [caseId, [`${chr}:${pos}:${ref}:${alt}`]],
    'vep:fetch': [chr, pos, ref, alt], 'vep:cancel': [], 'vep:getCacheStats': [],
    'hpo:search': ['seizure', 5], 'myvariant:fetch': [chr, pos, ref, alt], 'spliceai:fetch': [chr, pos, ref, alt],
    'case-metadata:get': [caseId], 'case-metadata:getFullMetadata': [caseId], 'case-metadata:listCohorts': [], 'case-metadata:getCohortByName': ['none'],
    'case-metadata:getCaseCohorts': [caseId], 'case-metadata:getHpoTerms': [caseId], 'case-metadata:getDataInfo': [caseId],
    'case-metadata:listExternalIds': [caseId], 'case-metadata:distinctHpoTerms': [], 'case-metadata:distinctPlatforms': [],
    'case-metadata:distinctExternalIdTypes': [], 'case-comments:list': [caseId], 'case-metrics:listDefinitions': [], 'case-metrics:listForCase': [caseId],
    'transcripts:list': [v.id], 'tags:list': [], 'tags:getUsageCount': [1], 'tags:getVariantTags': [caseId, v.id],
    'audit:getByEntity': [`variant:${chr}:${pos}:${ref}:${alt}`], 'audit:query': [{ limit: 5 }],
    'gene-lists:list': [], 'gene-lists:getGenes': [1], 'region-files:list': [], 'panels:list': [], 'panels:get': [1], 'panels:getGenes': [1],
    'panels:activeForCase': [caseId], 'panels:validateSymbols': [['TP53', 'NOTAGENE1']], 'panels:autocomplete': ['TP', 5],
    'panels:searchPanelApp': ['epilepsy', 'uk'], 'panels:exportBed': [1, 'GRCh38', 0],
    'gene-ref:info': [], 'gene-ref:assemblies': [], 'gene-ref:checkUpdates': [],
    'auth:currentUser': [], 'auth:isAccountsEnabled': [], 'auth:listUsers': [],
    'analysis-groups:list': [], 'analysis-groups:get': [1], 'analysis-groups:getForCase': [caseId],
    'protein:getMapping': [gene], 'protein:getDomains': ['P04637'], 'protein:getStructure': ['P04637'], 'protein:getGeneStructure': [gene],
    'gnomad:getVariants': [gene], 'gnomad:getClinVarVariants': [gene], 'perf:getSnapshot': [], 'debug:queryCountersGet': [],
    'jobs:list': [{}], 'jobs:get': ['x'], 'jobs:progress': ['x'], 'presets:list': [], 'database:health': []
  }

  const keys = [...surface.rows.filter((r) => r.web !== 'client-local' && r.web !== 'client-noop-event'), ...surface.serverOnlyOverrides.map((k) => ({ key: k, domain: k.split(':')[0], method: k.split(':')[1], web: 'override(server-only)' }))]
  const isWrite = (r) => r.web === 'write-task' || /:(create|update|delete|upsert|set|assign|remove|switch|insert|activate|deactivate|duplicate|reorder|import|add)/i.test(r.key)
  for (const r of keys) {
    const entry = { key: r.key, staticClass: r.web }
    if (SKIP.has(r.key) || (isWrite(r) && !(r.key in ARGS))) {
      entry.called = false
      entry.reason = SKIP.has(r.key) ? 'destructive/side-effect: skipped' : 'write method: skipped'
      out.rpc.push(entry)
      continue
    }
    const domainPath = r.key.split(':')[0]
    const args = ARGS[r.key] ?? []
    const t0 = Date.now()
    const res = await rpc(domainPath, r.key.split(':')[1], args)
    entry.called = true
    entry.args = JSON.stringify(args).slice(0, 120)
    entry.status = res.status
    entry.ms = Date.now() - t0
    let body = res.text
    try {
      const j = JSON.parse(body)
      if (j && typeof j === 'object' && 'code' in j && 'message' in j) entry.errorCode = `${j.code}: ${j.message}`.slice(0, 200)
    } catch {}
    entry.excerpt = body.slice(0, 220)
    out.rpc.push(entry)
    process.stdout.write(`${String(entry.status).padEnd(4)} ${r.key} ${entry.errorCode ?? ''}\n`)
  }

  // Admin user-management via API (on a throwaway user we create).
  const uname = `parity_user_${Date.now() % 100000}`
  for (const [k, args] of [
    ['auth:listUsers', []],
    ['auth:createUser', [uname, 'Parity User', 'Temp-Passw0rd-123!']],
    ['auth:listUsers', []],
    ['auth:updateRole', [uname, 'admin']],
    ['auth:setRole', [uname, 'admin']],
    ['auth:resetPassword', [uname, 'Another-Passw0rd-456!']],
    ['auth:deactivateUser', [uname]],
    ['auth:listUsers', []]
  ]) {
    let realArgs = args
    if (k === 'auth:resetPassword' || k === 'auth:deactivateUser') {
      const lu = JSON.parse((await rpc('auth', 'listUsers', [])).text)
      const list = Array.isArray(lu) ? lu : lu.users ?? []
      const u = list.find((x) => x.username === uname)
      if (u) realArgs = k === 'auth:resetPassword' ? [u.id, 'Another-Passw0rd-456!'] : [u.id]
    }
    const res = await rpc('auth', k.split(':')[1], realArgs)
    out.admin.push({ key: k, args: JSON.stringify(realArgs).replace(/Passw0rd[^"]*/g, '***'), status: res.status, excerpt: res.text.slice(0, 260) })
    process.stdout.write(`ADMIN ${res.status} ${k}\n`)
  }

  fs.writeFileSync(path.join(__dirname, 'api-probe.json'), JSON.stringify(out, null, 2))
  const by = out.rpc.filter((e) => e.called).reduce((a, e) => ((a[e.status] = (a[e.status] ?? 0) + 1), a), {})
  console.log('STATUS COUNTS', JSON.stringify(by))
})().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
