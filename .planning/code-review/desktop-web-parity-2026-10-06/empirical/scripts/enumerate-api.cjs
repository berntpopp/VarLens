// Enumerates every window.api.<domain>.<method> exposed by the desktop preload
// (with electron stubbed) and classifies whether the web server knows the key
// (override handler, read task, write task) or would answer 404 "unknown method".
// Also invokes each preload method with a dummy arg to capture its IPC channel.
const path = require('path')
const fs = require('fs')
const WT = '/home/bernt-popp/development/VarLens/.claude/worktrees/agent-a441a5be6bf38012d'
const OUT = __dirname
const stubPath = path.join(OUT, 'electron-stub.cjs')
fs.writeFileSync(
  stubPath,
  `let last = null
module.exports = {
  __getLast: () => last,
  contextBridge: { exposeInMainWorld() {} },
  ipcRenderer: {
    invoke: (ch, ...a) => { last = { kind: 'invoke', ch }; return Promise.resolve(null) },
    send: (ch) => { last = { kind: 'send', ch } },
    sendSync: (ch) => { last = { kind: 'sendSync', ch }; return null },
    on: (ch) => { last = { kind: 'on', ch } },
    removeListener() {}, removeAllListeners() {}, off() {}
  },
  webUtils: { getPathForFile: () => '' }
}`
)
const jiti = require(path.join(WT, 'node_modules/jiti'))(WT + '/', {
  alias: { electron: stubPath },
  interopDefault: true
})
const electron = require(stubPath)
const { createWindowApi } = jiti(path.join(WT, 'src/preload/window-api/create-window-api.ts'))
const taskTypes = jiti(path.join(WT, 'src/web/server/task-types.ts'))
const disp = jiti(path.join(WT, 'src/web/server/dispatcher.ts'))
const overrides = disp.buildDispatcher({}).overrides
const api = createWindowApi()
const WEB_CLIENT_LOCAL = {
  perf: ['reportInteractive', 'isEnabled'],
  shell: ['openExternal', 'updateDomains'],
  system: ['getVersion', 'getUserDataPath', 'getCpuCount', 'setWorkerThreads', 'getWorkerThreads', 'getLogFilePath'],
  updater: ['checkForUpdate', 'downloadUpdate', 'installUpdate', 'getStatus', 'onStatusChange'],
  export: ['revealInFolder'],
  import: ['onProgress', 'selectFile', 'selectFiles', 'selectBedFile', 'enrollDroppedFiles'],
  batchImport: ['onProgress', 'onComplete', 'selectFiles', 'selectFolder', 'selectZip'],
  variants: ['onAnnotationChanged'],
  cohort: ['onSummaryRebuilt']
}
const rows = []
for (const [domain, obj] of Object.entries(api)) {
  for (const method of Object.keys(obj)) {
    const key = `${taskTypes.toTaskDomain(domain)}:${method}`
    let channel = null
    try {
      const r = obj[method]('__probe__', () => {})
      channel = electron.__getLast()?.ch ?? null
      if (r && typeof r.catch === 'function') r.catch(() => {})
    } catch {}
    let web
    if ((WEB_CLIENT_LOCAL[domain] ?? []).includes(method)) web = 'client-local'
    else if (method.startsWith('on')) web = 'client-noop-event'
    else if (overrides[key]) web = 'override'
    else if (taskTypes.isReadTaskType(key)) web = 'read-task'
    else if (taskTypes.isWriteTaskType(key)) web = 'write-task'
    else web = 'UNKNOWN-404'
    rows.push({ domain, method, key, channel, web })
  }
}
const serverOnly = Object.keys(overrides).filter((k) => !rows.some((r) => r.key === k))
fs.writeFileSync(path.join(OUT, 'api-surface.json'), JSON.stringify({ rows, serverOnlyOverrides: serverOnly }, null, 2))
const counts = rows.reduce((a, r) => ((a[r.web] = (a[r.web] ?? 0) + 1), a), {})
console.log(JSON.stringify(counts))
console.log(rows.filter((r) => r.web === 'UNKNOWN-404' || r.web === 'client-noop-event').map((r) => `${r.web}\t${r.key}`).join('\n'))
process.exit(0)
