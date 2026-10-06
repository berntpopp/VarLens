/**
 * Bounded, reactive cache keyed by case id.
 *
 * Shared by the per-case renderer caches (comments, metrics) so they all have
 * the same size bound and the same single-case eviction semantics.
 *
 * The LRU lives in a `shallowRef` on purpose: `LruMap.get()` re-orders its
 * backing Map, and through a deep `ref` that write would fire inside the
 * computed that is reading it. Writes therefore replace values (never mutate
 * them in place) and notify readers explicitly.
 */

import { shallowRef, triggerRef } from 'vue'
import { LruMap } from '../../../shared/utils/lru-map'

/** Maximum number of cases each per-case renderer cache keeps. */
export const PER_CASE_CACHE_LIMIT = 200

export interface PerCaseCache<T> {
  get(caseId: number): T | undefined
  set(caseId: number, value: T): void
  isLoading(caseId: number): boolean
  /**
   * Fetch and store a case's value. No-op while a load for that case is in
   * flight. A result that arrives after `invalidate()` / `clear()` is dropped.
   * Rejects with whatever `fetch` rejects with.
   */
  load(caseId: number, fetch: () => Promise<T>): Promise<void>
  /** Drop one case: its value and any in-flight load. */
  invalidate(caseId: number): void
  /** Drop every case. */
  clear(): void
}

export function createPerCaseCache<T>(limit: number = PER_CASE_CACHE_LIMIT): PerCaseCache<T> {
  const entries = shallowRef(new LruMap<number, T>(limit))
  // caseId → token of the load currently allowed to write its result.
  const inFlight = shallowRef(new Map<number, symbol>())

  function get(caseId: number): T | undefined {
    return entries.value.get(caseId)
  }

  function set(caseId: number, value: T): void {
    entries.value.set(caseId, value)
    triggerRef(entries)
  }

  function isLoading(caseId: number): boolean {
    return inFlight.value.has(caseId)
  }

  async function load(caseId: number, fetch: () => Promise<T>): Promise<void> {
    if (inFlight.value.has(caseId)) return
    const token = Symbol('per-case-load')
    inFlight.value.set(caseId, token)
    triggerRef(inFlight)
    try {
      const value = await fetch()
      if (inFlight.value.get(caseId) === token) set(caseId, value)
    } finally {
      if (inFlight.value.get(caseId) === token) {
        inFlight.value.delete(caseId)
        triggerRef(inFlight)
      }
    }
  }

  function invalidate(caseId: number): void {
    if (entries.value.delete(caseId)) triggerRef(entries)
    if (inFlight.value.delete(caseId)) triggerRef(inFlight)
  }

  function clear(): void {
    entries.value.clear()
    triggerRef(entries)
    inFlight.value.clear()
    triggerRef(inFlight)
  }

  return { get, set, isLoading, load, invalidate, clear }
}
