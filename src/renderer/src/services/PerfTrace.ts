import { PERF_BUDGETS, type PerfBudgetKey } from '../../../shared/config/perf-budgets'
import { logService } from './LogService'

export interface PerfEntry {
  /** Flow name (e.g., 'case-switch', 'filter-apply') */
  name: string
  /** Duration in milliseconds */
  duration: number
  /** Budget key if applicable */
  budget?: PerfBudgetKey
  /** Whether duration exceeded the budget */
  overBudget: boolean
  /** ISO timestamp */
  timestamp: string
}

const MAX_ENTRIES = 100
const entries: PerfEntry[] = []
const activeTraces = new Map<string, number>()

/** Start a named trace. Returns the trace ID for passing to traceEnd. */
export function traceStart(name: string): string {
  const id = `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  activeTraces.set(id, performance.now())
  return id
}

/** End a trace and record the entry. Returns the entry or null if ID unknown. */
export function traceEnd(id: string, budget?: PerfBudgetKey): PerfEntry | null {
  const start = activeTraces.get(id)
  if (start === undefined) return null
  activeTraces.delete(id)

  const duration = performance.now() - start
  const budgetMs = budget !== undefined ? PERF_BUDGETS[budget] : undefined
  const overBudget = budgetMs !== undefined && duration > budgetMs

  const entry: PerfEntry = {
    name: id.replace(/-\d+-[a-z0-9]+$/, ''),
    duration: Math.round(duration * 100) / 100,
    budget,
    overBudget,
    timestamp: new Date().toISOString()
  }

  entries.push(entry)
  if (entries.length > MAX_ENTRIES) entries.shift()

  if (import.meta.env.DEV) {
    if (overBudget) {
      logService.warn(
        `[perf] ${entry.name} took ${entry.duration}ms (budget: ${budgetMs}ms)`,
        'perf'
      )
    } else if (duration > 50) {
      logService.debug(`[perf] ${entry.name}: ${entry.duration}ms`, 'perf')
    }
  }

  return entry
}

/**
 * Trace an async function from start to completion.
 * For multi-step user flows (where annotation hydration follows data fetch),
 * use traceStart/traceEnd manually to span the full flow.
 */
export async function traceAsync<T>(
  name: string,
  fn: () => Promise<T>,
  budget?: PerfBudgetKey
): Promise<T> {
  const id = traceStart(name)
  try {
    return await fn()
  } finally {
    traceEnd(id, budget)
  }
}

/** Get recent entries (most recent first). */
export function getRecentTraces(limit = 20): readonly PerfEntry[] {
  return entries.slice(-limit).reverse()
}

/** Clear all traces (for testing). */
export function clearTraces(): void {
  entries.length = 0
  activeTraces.clear()
}
