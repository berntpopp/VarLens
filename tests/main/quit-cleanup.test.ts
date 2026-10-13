import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/main/services/MainLogger', () => ({
  mainLogger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() }
}))

import { installQuitCleanup, type QuitApp } from '../../src/main/quit-cleanup'

function fakeApp() {
  let listener: ((event: { preventDefault(): void }) => void) | undefined
  const app: QuitApp & { quit: ReturnType<typeof vi.fn> } = {
    on: (_event, l) => {
      listener = l
    },
    quit: vi.fn()
  }
  const emit = () => {
    const event = { preventDefault: vi.fn() }
    listener!(event)
    return event
  }
  return { app, emit }
}

describe('installQuitCleanup (#552)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('cancels the first quit, awaits cleanup, then quits; the repeat event passes through', async () => {
    const { app, emit } = fakeApp()
    let finish!: () => void
    const cleanup = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    installQuitCleanup(app, cleanup)

    const first = emit()
    expect(first.preventDefault).toHaveBeenCalledOnce()
    expect(cleanup).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(10)
    expect(app.quit).not.toHaveBeenCalled()

    finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(app.quit).toHaveBeenCalledOnce()

    const repeat = emit()
    expect(repeat.preventDefault).not.toHaveBeenCalled()
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('quits after the timeout when cleanup hangs', async () => {
    const { app, emit } = fakeApp()
    installQuitCleanup(app, () => new Promise<void>(() => {}), 5_000)

    emit()
    await vi.advanceTimersByTimeAsync(4_999)
    expect(app.quit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(app.quit).toHaveBeenCalledOnce()
  })

  it('still quits when cleanup rejects', async () => {
    const { app, emit } = fakeApp()
    installQuitCleanup(app, () => Promise.reject(new Error('close failed')))

    emit()
    await vi.advanceTimersByTimeAsync(0)
    expect(app.quit).toHaveBeenCalledOnce()
  })
})
