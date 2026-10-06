let last = null
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
}