/**
 * Interaction-quality probes for the renderer perf E2E (audit 2026-10-06 §9):
 * PerformanceObserver layout-shift + event-timing (INP) windows around a
 * single table interaction, and a query spy on the case/cohort table query channels.
 *
 * The query spy wraps the main-process `ipcMain` handler (test-only), because
 * the contextBridge-exposed `window.api` is frozen in the renderer. It counts
 * calls (and their page offsets), can delay the first N calls (to force out-of-order responses) and
 * records the first row's position of every response so the test can prove which
 * response the table rendered.
 */
import type { ElectronApplication, Page } from '@playwright/test'

export interface InteractionMetrics {
  /** CWV layout-shift sum (excludes shifts within 500 ms of input). */
  cls: number
  /** Every layout shift in the window, input-adjacent ones included. */
  allShifts: number
  /** Longest event-timing duration among entries with an interactionId. */
  inpMs: number
  interactionCount: number
  events?: string[]
}

interface VitalsWindow {
  __varlensVitals?: {
    shifts: Array<{ value: number; hadRecentInput: boolean }>
    events: Array<{ duration: number; interactionId: number; name?: string }>
    observers: PerformanceObserver[]
  }
}

export async function startInteractionWindow(page: Page): Promise<void> {
  await page.evaluate(() => {
    const host = window as unknown as VitalsWindow
    host.__varlensVitals?.observers.forEach((observer) => observer.disconnect())
    const vitals = {
      shifts: [] as Array<{ value: number; hadRecentInput: boolean }>,
      events: [] as Array<{ duration: number; interactionId: number; name?: string }>,
      observers: [] as PerformanceObserver[]
    }
    const shiftObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<
        PerformanceEntry & { value: number; hadRecentInput: boolean }
      >) {
        vitals.shifts.push({ value: entry.value, hadRecentInput: entry.hadRecentInput })
      }
    })
    shiftObserver.observe({ type: 'layout-shift', buffered: false })
    const eventObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<PerformanceEntry & { interactionId?: number }>) {
        if ((entry.interactionId ?? 0) > 0) {
          vitals.events.push({ duration: entry.duration, interactionId: entry.interactionId ?? 0, name: entry.name })
        }
      }
    })
    eventObserver.observe({ type: 'event', durationThreshold: 16, buffered: false } as PerformanceObserverInit)
    vitals.observers = [shiftObserver, eventObserver]
    host.__varlensVitals = vitals
  })
}

export async function readInteractionWindow(page: Page): Promise<InteractionMetrics> {
  // Two frames so trailing layout-shift / event entries are delivered.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  )
  return await page.evaluate(() => {
    const vitals = (window as unknown as VitalsWindow).__varlensVitals
    if (vitals === undefined) throw new Error('startInteractionWindow() was not called')
    vitals.observers.forEach((observer) => observer.disconnect())
    const round = (value: number): number => Math.round(value * 10_000) / 10_000
    const ids = new Set(vitals.events.map((event) => event.interactionId))
    return {
      cls: round(vitals.shifts.filter((s) => !s.hadRecentInput).reduce((sum, s) => sum + s.value, 0)),
      allShifts: round(vitals.shifts.reduce((sum, s) => sum + s.value, 0)),
      inpMs: vitals.events.reduce((max, event) => Math.max(max, event.duration), 0),
      interactionCount: ids.size,
      events: vitals.events.map((e) => `${e.name}:${Math.round(e.duration)}`)
    }
  })
}

export async function waitForQuiet(page: Page, ms = 600): Promise<void> {
  await page.waitForTimeout(ms)
}

export type SpiedChannel = 'variants:query' | 'cohort:variants'

interface QuerySpyState {
  original: (event: unknown, ...args: unknown[]) => Promise<unknown>
  calls: number
  firstPositions: Array<number | null>
  /** Page offset requested by each call (prefetches use the adjacent pages). */
  offsets: Array<number | null>
  /** Truncated arguments of each call, for diagnostics. */
  callArgs: string[]
}

/** Install (or reset) a spy on a table query channel in the main process. */
export async function installQuerySpy(
  app: ElectronApplication,
  channel: SpiedChannel,
  options: { delayFirstCallsMs?: number; delayedCalls?: number } = {}
): Promise<void> {
  await app.evaluate(
    ({ ipcMain }, { name, opts }) => {
      type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>
      const registry = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })
        ._invokeHandlers
      const g = globalThis as unknown as { __varlensQuerySpies?: Record<string, QuerySpyState> }
      g.__varlensQuerySpies ??= {}
      const original = g.__varlensQuerySpies[name]?.original ?? registry.get(name)
      if (original === undefined) throw new Error(`${name} handler is not registered`)
      const spy: QuerySpyState = { original, calls: 0, firstPositions: [], offsets: [], callArgs: [] }
      g.__varlensQuerySpies[name] = spy
      registry.set(name, async (event, ...args) => {
        spy.calls += 1
        const callIndex = spy.calls
        spy.callArgs.push(JSON.stringify(args).slice(0, 400))
        // variants:query(caseId, filters, offset, limit, …) | cohort:variants({ offset?, limit, … })
        // (the cohort params builder drops a zero offset).
        const offset =
          typeof args[2] === 'number' ? args[2] : ((args[0] as { offset?: number }).offset ?? 0)
        spy.offsets.push(typeof offset === 'number' ? offset : null)
        if (callIndex <= (opts.delayedCalls ?? 0)) {
          await new Promise((resolve) => setTimeout(resolve, opts.delayFirstCallsMs ?? 0))
        }
        const result = await original(event, ...args)
        // IpcResult<page>: the page itself ({ data: rows }) or a SerializableError.
        const first = (result as { data?: Array<{ pos?: unknown }> }).data?.[0]
        spy.firstPositions[callIndex - 1] = first === undefined ? null : Number(first.pos)
        return result
      })
    },
    { name: channel, opts: options }
  )
}

export async function readQuerySpy(
  app: ElectronApplication,
  channel: SpiedChannel
): Promise<{
  calls: number
  firstPositions: Array<number | null>
  offsets: Array<number | null>
  callArgs: string[]
}> {
  return await app.evaluate((_electron, name) => {
    const spies = (globalThis as unknown as { __varlensQuerySpies?: Record<string, QuerySpyState> })
      .__varlensQuerySpies
    const spy = spies?.[name]
    return {
      calls: spy?.calls ?? 0,
      firstPositions: [...(spy?.firstPositions ?? [])],
      offsets: [...(spy?.offsets ?? [])],
      callArgs: [...(spy?.callArgs ?? [])]
    }
  }, channel)
}
