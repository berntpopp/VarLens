// Static desktop<->web routing map: every window.api method (from preload app-api
// domain contracts via mockApi shape) vs what the web dispatcher can resolve.
const root = '/home/bernt-popp/development/VarLens/.claude/worktrees/agent-ac57519ac046a3228'
const jiti = require(root + '/node_modules/jiti')(root + '/x.js', { interopDefault: true })
const routes = [
  'analysis-groups', 'annotations', 'audit-log', 'auth', 'batch-import', 'case-metadata',
  'cases', 'cohort', 'database', 'export', 'gene-lists', 'gene-ref', 'hpo', 'import',
  'panels', 'protein', 'region-files', 'transcripts', 'vep', 'variants'
]
const overrides = {}
for (const r of routes) {
  const mod = jiti(`${root}/src/web/server/routes/${r}.ts`)
  for (const [k, fn] of Object.entries(mod)) {
    if (k.startsWith('build') && typeof fn === 'function') {
      try { Object.assign(overrides, fn()) } catch (e) { console.error('builder failed', k, e.message) }
    }
  }
}
const tt = jiti(`${root}/src/web/server/task-types.ts`)
const fs = require('fs')
const src = fs.readFileSync(`${root}/src/web/server/dispatcher.ts`, 'utf8')
const extraOverrides = [...src.matchAll(/'([a-zA-Z]+:[a-zA-Z]+)'\s*:/g)].map((m) => m[1])
const { mockApi } = jiti(`${root}/src/renderer/src/mocks/mockApi.ts`)
const out = []
for (const [domain, obj] of Object.entries(mockApi)) {
  if (obj === null || typeof obj !== 'object') continue
  for (const method of Object.keys(obj)) {
    if (typeof obj[method] !== 'function') continue
    const key = `${tt.toTaskDomain ? tt.toTaskDomain(domain) : domain}:${method}`
    let how = 'UNROUTED (404 in web)'
    if (overrides[key]) how = 'override'
    else if (extraOverrides.includes(key)) how = 'dispatcher-inline'
    else if (tt.isReadTaskType?.(key)) how = 'read-task'
    else if (tt.isWriteTaskType?.(key)) how = 'write-task'
    if (/^on[A-Z]/.test(method)) how += ' (event subscriber; client-side SSE bridge)'
    out.push(`${key}\t${how}`)
  }
}
console.log(out.join('\n'))
