import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { IpcMain } from 'electron'
import {
  beginDatabaseStartup,
  completeDatabaseStartup,
  gateIpcMainOnDatabaseStartup,
  whenDatabaseReady
} from '../../src/main/database/startup-gate'
import { openDefaultDatabaseAfterWindow } from '../../src/main/startup-sequence'

class FakeWindow extends EventEmitter {
  destroyed = false
  isDestroyed(): boolean {
    return this.destroyed
  }
}

describe('openDefaultDatabaseAfterWindow', () => {
  it('opens the database only after the window painted', async () => {
    const window = new FakeWindow()
    const order: string[] = []

    const done = openDefaultDatabaseAfterWindow(window, {
      openDefault: async () => {
        order.push('open')
      },
      onOpenFailed: () => order.push('failed'),
      onSettled: () => order.push('settled'),
      firstPaintTimeoutMs: 10_000
    })

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(order).toEqual([])

    order.push('ready-to-show')
    window.emit('ready-to-show')
    await done

    expect(order).toEqual(['ready-to-show', 'open', 'settled'])
  })

  it('does not wait forever for a renderer that never paints', async () => {
    const window = new FakeWindow()
    const openDefault = vi.fn(async () => undefined)

    await openDefaultDatabaseAfterWindow(window, {
      openDefault,
      onOpenFailed: vi.fn(),
      onSettled: vi.fn(),
      firstPaintTimeoutMs: 5
    })

    expect(openDefault).toHaveBeenCalledOnce()
  })

  it('reports a failed open and still settles', async () => {
    const window = new FakeWindow()
    window.destroyed = true
    const onOpenFailed = vi.fn()
    const onSettled = vi.fn()

    await openDefaultDatabaseAfterWindow(window, {
      openDefault: async () => {
        throw new Error('locked')
      },
      onOpenFailed,
      onSettled
    })

    expect(onOpenFailed).toHaveBeenCalledWith(new Error('locked'))
    expect(onSettled).toHaveBeenCalledOnce()
  })
})

describe('database startup gate', () => {
  it('holds gated IPC invokes until startup completes, passing other members through', async () => {
    const registered = new Map<string, (...args: unknown[]) => unknown>()
    const raw = {
      handle: (channel: string, listener: (...args: unknown[]) => unknown) => {
        registered.set(channel, listener)
      },
      listenerCount: () => 7
    } as unknown as IpcMain

    beginDatabaseStartup()
    const gated = gateIpcMainOnDatabaseStartup(raw)
    gated.handle('cases:list', async () => 'cases')
    expect(gated.listenerCount('x')).toBe(7)

    let settled = false
    const pending = (registered.get('cases:list')!({}) as Promise<unknown>).then((value) => {
      settled = true
      return value
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(settled).toBe(false)

    completeDatabaseStartup()
    await expect(pending).resolves.toBe('cases')
    await expect(whenDatabaseReady()).resolves.toBeUndefined()
  })
})
