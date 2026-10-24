import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fc from 'fast-check'
import type { IpcMain } from 'electron'
import { createIpcRegistrars } from '../../../src/main/ipc/registrars'
import {
  beginDatabaseStartup,
  completeDatabaseStartup,
  gateIpcMainOnDatabaseStartup
} from '../../../src/main/database/startup-gate'
import {
  passThroughProvider,
  setAccessProvider,
  type AccessProvider
} from '../../../src/main/auth/access-gate'
import { isIpcError } from '../../../src/shared/types/errors'

type Handler = (...args: unknown[]) => unknown

function fakeIpcMain(): { raw: IpcMain; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>()
  const raw = {
    handle: (channel: string, listener: Handler) => {
      handlers.set(channel, listener)
    }
  } as unknown as IpcMain
  return { raw, handlers }
}

/** True when `promise` settles before the next macrotask. */
async function settlesAtOnce(promise: Promise<unknown>): Promise<boolean> {
  let settled = false
  promise.then(
    () => (settled = true),
    () => (settled = true)
  )
  await new Promise(setImmediate)
  return settled
}

async function outcome(run: () => unknown): Promise<{ ok: boolean; value: unknown }> {
  try {
    return { ok: true, value: await run() }
  } catch (error) {
    return { ok: false, value: error }
  }
}

describe('createIpcRegistrars', () => {
  beforeEach(() => setAccessProvider(passThroughProvider))
  afterEach(() => completeDatabaseStartup())

  it('without a sign-in mode answers exactly as the registration on main', async () => {
    // Main: data domains on the startup gate, jobs and debug on the raw ipcMain.
    const onMain = (raw: IpcMain): Record<'startupGated' | 'accessOnly', IpcMain> => ({
      startupGated: gateIpcMainOnDatabaseStartup(raw),
      accessOnly: raw
    })
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 40 }),
        fc.array(fc.anything(), { maxLength: 5 }),
        fc.anything(),
        fc.constantFrom('return', 'throw', 'reject'),
        fc.constantFrom('startupGated' as const, 'accessOnly' as const),
        async (channel, input, value, how, which) => {
          const seen: unknown[][] = []
          const listener: Handler = (...received) => {
            seen.push(received)
            if (how === 'throw') throw value
            return how === 'reject' ? Promise.reject(value) : value
          }
          const event = { sender: {} }
          const main = fakeIpcMain()
          const now = fakeIpcMain()
          onMain(main.raw)[which].handle(channel, listener)
          createIpcRegistrars(now.raw)[which].handle(channel, listener)

          const before = await outcome(() => main.handlers.get(channel)!(event, ...input))
          const after = await outcome(() => now.handlers.get(channel)!(event, ...input))
          expect(after.ok).toBe(before.ok)
          expect(after.value).toBe(before.value)
          expect(seen).toHaveLength(2)
          expect(seen[1][0]).toBe(event)
          seen[1].slice(1).forEach((received, index) => expect(received).toBe(input[index]))
        }
      )
    )
  })

  it('lets jobs and debug answer while the database is still opening, as before', async () => {
    const { raw, handlers } = fakeIpcMain()
    const { accessOnly } = createIpcRegistrars(raw)
    accessOnly.handle('jobs:list', async () => 'jobs')

    beginDatabaseStartup()
    const pending = handlers.get('jobs:list')!({}) as Promise<unknown>

    expect(await settlesAtOnce(pending)).toBe(true)
    await expect(pending).resolves.toBe('jobs')
  })

  it('holds data channels until the database startup settles, as before', async () => {
    const { raw, handlers } = fakeIpcMain()
    const { startupGated } = createIpcRegistrars(raw)
    startupGated.handle('cases:list', async () => 'cases')

    beginDatabaseStartup()
    const pending = handlers.get('cases:list')!({}) as Promise<unknown>
    expect(await settlesAtOnce(pending)).toBe(false)

    completeDatabaseStartup()
    await expect(pending).resolves.toBe('cases')
  })

  it('puts both behind the access gate in a locked sign-in mode', async () => {
    const locked: AccessProvider = { mode: 'platform', isUnlocked: () => false }
    const { raw, handlers } = fakeIpcMain()
    const { startupGated, accessOnly } = createIpcRegistrars(raw)
    startupGated.handle('cases:list', async () => 'cases')
    accessOnly.handle('jobs:list', async () => 'jobs')

    setAccessProvider(locked)
    expect(isIpcError(await handlers.get('cases:list')!({}))).toBe(true)
    expect(isIpcError(await handlers.get('jobs:list')!({}))).toBe(true)
  })
})
