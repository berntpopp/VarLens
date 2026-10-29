/**
 * The real IPC registration behind the access gate (#295), at runtime.
 *
 * - Locked sign-in mode: every registered channel except the allowlist
 *   answers UNAUTHENTICATED without its handler running (deny by default).
 * - No sign-in mode: exactly as on main, only the jobs and debug channels
 *   answer while the database is still opening; every other channel waits.
 *
 * Together with the raw-ipcMain holder check (ipc-raw-holders.test.ts) this
 * covers every channel the main process can answer.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const registered = vi.hoisted(() => new Map<string, Handler>())
const userData = vi.hoisted(() => ({ path: '' }))

vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('electron', () => {
  const ipcMain = {
    handle: (channel: string, listener: Handler) => registered.set(channel, listener),
    removeHandler: (channel: string) => registered.delete(channel),
    on: () => ipcMain,
    once: () => ipcMain
  }
  return {
    ipcMain,
    app: {
      getPath: () => userData.path,
      getVersion: () => '0.0.0',
      isPackaged: true,
      on: () => undefined
    },
    BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
    dialog: {},
    shell: {},
    net: {},
    powerMonitor: { on: () => undefined, off: () => undefined },
    safeStorage: { isEncryptionAvailable: () => false }
  }
})

import {
  CHANNELS_WITHOUT_SESSION,
  LOCAL_ACCOUNT_CHANNELS,
  SERVER_WORKSPACE_CHANNELS,
  passThroughProvider,
  setAccessProvider
} from '../../../src/main/auth/access-gate'
import {
  beginDatabaseStartup,
  completeDatabaseStartup
} from '../../../src/main/database/startup-gate'
import { registerIpcHandlers } from '../../../src/main/ipc/index'
import { ErrorCode, isIpcError } from '../../../src/shared/types/errors'

/** True when `value` settles before the next macrotask. */
async function settlesAtOnce(value: unknown): Promise<boolean> {
  let settled = false
  void Promise.resolve(value).then(
    () => (settled = true),
    () => (settled = true)
  )
  await new Promise(setImmediate)
  return settled
}

describe('IPC registration behind the access gate', () => {
  beforeAll(() => {
    userData.path = mkdtempSync(join(tmpdir(), 'varlens-ipc-access-'))
    registerIpcHandlers()
  })
  afterEach(() => setAccessProvider(passThroughProvider))
  afterAll(() => rmSync(userData.path, { recursive: true, force: true }))

  it('refuses every channel but the allowlist while a sign-in mode is locked', async () => {
    expect(registered.size).toBeGreaterThan(200)
    setAccessProvider({ mode: 'platform', isUnlocked: () => false })
    const answered: string[] = []
    const forbidden: string[] = []
    for (const [channel, handler] of registered) {
      if (CHANNELS_WITHOUT_SESSION.has(channel)) continue
      const result = await handler({ sender: {} })
      const code = isIpcError(result) ? (result as { code: string }).code : undefined
      if (code === ErrorCode.FORBIDDEN) forbidden.push(channel)
      else if (code !== ErrorCode.UNAUTHENTICATED) answered.push(channel)
    }
    expect(answered).toEqual([])
    // Platform mode refuses these even signed in, and they all exist.
    expect(forbidden.sort()).toEqual(
      [...LOCAL_ACCOUNT_CHANNELS, ...SERVER_WORKSPACE_CHANNELS].sort()
    )
    for (const channel of CHANNELS_WITHOUT_SESSION) expect(registered.has(channel)).toBe(true)
  })

  it('lets only jobs and debug answer before the database opens, as on main', async () => {
    beginDatabaseStartup()
    const early: string[] = []
    const calls: unknown[] = []
    for (const [channel, handler] of registered) {
      const call = handler({ sender: {} })
      calls.push(call)
      if (await settlesAtOnce(call)) early.push(channel)
    }
    // Release the waiting calls behind a locked gate, so none of their handlers runs.
    setAccessProvider({ mode: 'platform', isUnlocked: () => false })
    completeDatabaseStartup()
    await Promise.allSettled(calls)
    expect(early.every((channel) => /^(jobs|debug):/.test(channel))).toBe(true)
    expect(early).toEqual(
      expect.arrayContaining(['jobs:list', 'jobs:get', 'debug:queryCounters:get'])
    )
  })
})
