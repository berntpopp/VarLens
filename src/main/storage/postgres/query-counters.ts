import type { Pool, PoolClient, QueryConfig } from 'pg'

interface CounterState {
  named: Record<string, number>
  unnamed: number
}

const state: CounterState = { named: {}, unnamed: 0 }

export function getCounters(): { named: Record<string, number>; unnamed: number } {
  return { named: { ...state.named }, unnamed: state.unnamed }
}

export function resetCounters(): void {
  state.unnamed = 0
  for (const k of Object.keys(state.named)) delete state.named[k]
}

function increment(arg: unknown): void {
  if (typeof arg === 'object' && arg !== null && typeof (arg as QueryConfig).name === 'string') {
    const name = (arg as QueryConfig).name as string
    state.named[name] = (state.named[name] ?? 0) + 1
  } else {
    state.unnamed += 1
  }
}

/**
 * Sprint A PR-2 B3 — Pool counter proxy.
 *
 * Sole owner of named/unnamed query counters (Pass-7 MED #3). runNamed and
 * runNamedDynamic dispatch through this proxy and are counted here, not in
 * the helpers themselves — otherwise named calls would be counted twice.
 *
 * Install site: createPostgresStorageSession.ts, between the migration
 * runner and the PostgresStorageSession constructor (Pass-8 #4). Wrapping
 * after migrations avoids polluting counters with one-off DDL traffic.
 */
export function wrapPoolForCounters(pool: Pool): Pool {
  const query = ((arg: unknown, values?: unknown) => {
    increment(arg)
    return (pool.query as (...a: unknown[]) => Promise<unknown>)(arg, values)
  }) as Pool['query']

  const connect = (async (...args: unknown[]) => {
    const client = await (pool.connect as (...a: unknown[]) => Promise<PoolClient>)(...args)
    const clientQuery = ((arg: unknown, vs?: unknown) => {
      increment(arg)
      return (client.query as (...a: unknown[]) => Promise<unknown>)(arg, vs)
    }) as PoolClient['query']
    return delegate(client, { query: clientQuery })
  }) as Pool['connect']

  return delegate(pool, { query, connect })
}

/**
 * `target` with `overrides`. Every other member runs on `target` itself: a
 * wrapper built with Object.create would let pg-pool keep its state (`ending`,
 * `_clients`) on the wrapper, so `end()` never saw a client released after it
 * and hung forever.
 */
function delegate<T extends object>(target: T, overrides: Partial<T>): T {
  return new Proxy(target, {
    get(t, prop) {
      if (Object.prototype.hasOwnProperty.call(overrides, prop)) return overrides[prop as keyof T]
      const value: unknown = Reflect.get(t, prop, t)
      return typeof value === 'function' ? value.bind(t) : value
    }
  })
}
