// Generates markdown tables (steps, grouped failures, API probe) from the JSON outputs.
const fs = require('fs')
const path = require('path')
const crawl = JSON.parse(fs.readFileSync(path.join(__dirname, 'crawl-results.json'), 'utf8'))
const probe = JSON.parse(fs.readFileSync(path.join(__dirname, 'api-probe.json'), 'utf8'))
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
const lines = []
lines.push('## Step table\n')
lines.push('| # | Step | Status (raw) | Failed requests | Console errors | Note |')
lines.push('|---|---|---|---|---|---|')
crawl.steps.forEach((s, i) => {
  const fr = [...new Set(s.failedRequests.map((f) => `${f.status ?? f.failure} ${f.method ?? ''} ${f.url.split('?')[0]}`))].join('<br>')
  const ce = s.consoleErrors.length + s.pageErrors.length
  lines.push(`| ${i + 1} | ${esc(s.name)} | ${s.status}${s.rawStatus !== s.status ? ` (${s.rawStatus})` : ""} | ${esc(fr)} | ${ce} | ${esc(s.reviewNote ?? s.note).slice(0, 300)} |`)
})
const counts = crawl.steps.reduce((a, s) => ((a[s.status] = (a[s.status] ?? 0) + 1), a), {})
lines.push(`\nCounts: ${JSON.stringify(counts)}\n`)

lines.push('## Failed requests grouped by endpoint + status\n')
const groups = {}
for (const s of crawl.steps) {
  for (const f of s.failedRequests) {
    const k = `${f.status ?? f.failure} ${f.method ?? ''} ${f.url.split('?')[0]}`
    groups[k] = groups[k] ?? { steps: new Set(), body: f.body }
    groups[k].steps.add(s.name)
  }
}
lines.push('| Endpoint | Steps affected | Response body excerpt |')
lines.push('|---|---|---|')
for (const [k, g] of Object.entries(groups).sort()) lines.push(`| ${esc(k)} | ${esc([...g.steps].join('; '))} | ${esc((g.body ?? '').slice(0, 200))} |`)

lines.push('\n## API probe (authenticated RPC)\n')
lines.push('| Key | Static class | Called | Status | Error |')
lines.push('|---|---|---|---|---|')
for (const e of probe.rpc) lines.push(`| ${e.key} | ${e.staticClass} | ${e.called ? 'yes' : `no (${e.reason})`} | ${e.status ?? ''} | ${esc(e.errorCode ?? '')} |`)
fs.writeFileSync(path.join(__dirname, 'tables.md'), lines.join('\n') + '\n')
console.log(JSON.stringify(counts))
